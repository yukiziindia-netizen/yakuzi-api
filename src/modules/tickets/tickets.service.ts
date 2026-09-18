import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { CreateMessageDto } from './dto/create-message.dto';
import { Role, TicketStatus } from '@prisma/client';
import { BuyerEmailsService } from '../mail/buyer-emails.service';
import { SellerEmailsService } from '../mail/seller-emails.service';
import { AdminAlertsService } from '../mail/admin-alerts.service';

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly buyerEmails: BuyerEmailsService,
    private readonly sellerEmails: SellerEmailsService,
    private readonly adminAlerts: AdminAlertsService,
  ) {}

  /**
   * Fires a notification and forgets it — safely.
   *
   * `void somePromise` is not enough on its own: it swallows a rejection but
   * NOT a synchronous throw, so a notification service that blew up before
   * returning its promise would take the order operation down with it. This
   * wraps both cases, because none of these calls is ever worth failing an
   * order, a cancellation or a tracking submission for.
   */
  private detach(label: string, run: () => Promise<unknown>): void {
    void Promise.resolve()
      .then(run)
      .catch((error: unknown) => {
        this.logger.warn(
          `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }

  /**
   * Create a support ticket. Any authenticated user can open one.
   * The first message is created together with the ticket.
   */
  async createTicket(userId: string, dto: CreateTicketDto) {
    // A ticket may name an order, but only the raiser's own. Without this
    // check anyone could attach a stranger's order id and have the sellers on
    // it emailed a complaint that has nothing to do with them.
    let orderId: string | null = null;
    if (dto.orderId) {
      const order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { id: true, buyerId: true },
      });
      if (!order || order.buyerId !== userId) {
        throw new ForbiddenException('That order is not yours.');
      }
      orderId = order.id;
    }

    const ticket = await this.prisma.ticket.create({
      data: {
        userId,
        orderId,
        subject: dto.subject,
        messages: {
          create: {
            senderId: userId,
            message: dto.message,
          },
        },
      },
      include: {
        messages: {
          select: {
            id: true,
            senderId: true,
            message: true,
            createdAt: true,
          },
        },
      },
    });

    this.logger.log(`Ticket created: ${ticket.id} by user ${userId}`);

    // Acknowledge it straight away, so nobody is left wondering whether the
    // message went anywhere. Detached: raising a ticket must not fail because
    // the mail server is slow, least of all for someone already having a
    // problem.
    this.detach('ticket acknowledgement', () =>
      this.buyerEmails.sendTicketReceived(ticket.id),
    );

    // Somebody has to know a customer is waiting. Until this existed a ticket
    // sat unread until an admin happened to open the panel.
    this.detach('admin ticket alert', () => this.adminAlerts.ticketRaised(ticket.id));

    // And when the ticket names an order, the sellers on it hear about it too
    // — a complaint about a figure should not reach the person who sold it
    // only when the refund lands. No-ops for a general question.
    this.detach('seller ticket alert', () =>
      this.sellerEmails.sendTicketRaised(ticket.id),
    );

    return ticket;
  }

  /**
   * Get tickets. Buyers/Sellers see only their own; Admins see all.
   */
  async getTickets(userId: string, role: Role) {
    const where = role === Role.ADMIN ? {} : { userId };

    const tickets = await this.prisma.ticket.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            phone: true,
            role: true,
          },
        },
        messages: {
          select: {
            id: true,
            senderId: true,
            message: true,
            createdAt: true,
            sender: {
              select: { id: true, role: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { messages: true } },
      },
    });

    return tickets.map((ticket) => ({
      ...ticket,
      description: ticket.messages[0]?.message || '',
    }));
  }

  /**
   * Add a message to a ticket.
   * - Ticket owner can always add messages.
   * - Admin can add messages to any ticket.
   */
  async addMessage(
    userId: string,
    role: Role,
    ticketId: string,
    dto: CreateMessageDto,
  ) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Only the ticket owner or an admin can post messages
    if (ticket.userId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    // Reopen ticket if it was resolved/closed and the user adds a message
    const shouldReopen =
      (ticket.status === 'RESOLVED' || ticket.status === 'CLOSED') &&
      ticket.userId === userId;

    const [message] = await this.prisma.$transaction([
      this.prisma.message.create({
        data: {
          ticketId,
          senderId: userId,
          message: dto.message,
        },
        select: {
          id: true,
          senderId: true,
          message: true,
          createdAt: true,
        },
      }),
      // Update ticket status based on who is replying
      this.prisma.ticket.update({
        where: { id: ticketId },
        data: {
          status: shouldReopen
            ? 'OPEN'
            : role === Role.ADMIN
              ? 'IN_PROGRESS'
              : undefined,
        },
      }),
    ]);

    this.logger.log(`Message added to ticket ${ticketId} by user ${userId}`);

    // Tell the person who raised the ticket that somebody answered. Only for
    // replies from our side — the service also refuses to email anyone their
    // own message back, so a buyer adding a follow-up stays silent.
    if (role === Role.ADMIN) {
      this.detach('ticket reply notice', () =>
        this.buyerEmails.sendTicketReply(ticketId, message.id),
      );
    }

    return message;
  }

  /**
   * Get a ticket by ID.
   * - Ticket owner can always see their own ticket.
   * - Admin can see any ticket.
   */
  async getTicketById(userId: string, role: Role, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: {
        id: true,
        subject: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        userId: true,
        user: {
          select: {
            id: true,
            phone: true,
            role: true,
          },
        },
        messages: {
          select: {
            id: true,
            senderId: true,
            message: true,
            createdAt: true,
            sender: {
              select: { id: true, role: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    if (ticket.userId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    // Map first message to description for frontend compatibility if needed
    return {
      ...ticket,
      description: ticket.messages[0]?.message || '',
    };
  }

  /**
   * Closes a ticket. Either side may: the person who raised it, once their
   * problem is solved, or an admin from the support screen.
   *
   * The "Close ticket" button in the buyer's support drawer has always been
   * there — this is the endpoint it has been calling into thin air.
   */
  async closeTicket(userId: string, role: Role, ticketId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      select: { id: true, userId: true, status: true },
    });

    if (!ticket) {
      throw new NotFoundException('Ticket not found');
    }

    // Same rule getTicketById applies: your own ticket, or you are an admin.
    if (ticket.userId !== userId && role !== Role.ADMIN) {
      throw new ForbiddenException('You do not have access to this ticket');
    }

    // Closing a closed ticket is not an error. The button can be pressed twice,
    // and support and the buyer can close the same ticket at the same moment.
    if (ticket.status === TicketStatus.CLOSED) {
      return this.getTicketById(userId, role, ticketId);
    }

    await this.prisma.ticket.update({
      where: { id: ticketId },
      data: { status: TicketStatus.CLOSED },
    });

    this.logger.log(
      `Ticket ${ticketId} closed by ${role === Role.ADMIN ? 'support' : 'the buyer'}`,
    );

    return this.getTicketById(userId, role, ticketId);
  }

}

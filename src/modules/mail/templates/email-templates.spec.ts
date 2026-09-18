import { renderEmail, escapeHtml, safeUrl } from './email-layout';
import { productList, panel, button, quote, rupees } from './email-blocks';

describe('email templates', () => {
  describe('escaping', () => {
    it('neutralises markup in anything a buyer or seller typed', () => {
      const html = escapeHtml('<script>alert("x")</script>');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes quotes, so a value cannot break out of an attribute', () => {
      expect(escapeHtml('a" onmouseover="evil()')).not.toContain('"');
    });
  });

  describe('safeUrl', () => {
    it('passes http and https through', () => {
      expect(safeUrl('https://yukizi.com/orders')).toBe('https://yukizi.com/orders');
      expect(safeUrl('http://localhost:3000/x')).toBe('http://localhost:3000/x');
    });

    it('refuses javascript: and data: rather than emitting them', () => {
      expect(safeUrl('javascript:alert(1)')).not.toContain('javascript');
      expect(safeUrl('data:text/html;base64,PHNjcmlwdD4=')).not.toContain('data:');
    });

    it('falls back to the storefront for anything malformed', () => {
      expect(safeUrl('')).toContain('yukizi');
      expect(safeUrl(null)).toContain('yukizi');
    });
  });

  describe('renderEmail', () => {
    const html = renderEmail({
      preheader: 'Short summary for the inbox',
      eyebrow: 'Order update',
      title: 'Your order is on its way',
      subtitle: 'It left the seller this morning.',
      blocks: [button('Track it', 'https://yukizi.com/orders')],
      footerNote: 'Nothing was charged.',
    });

    it('is a complete document, not a fragment', () => {
      expect(html).toContain('<!DOCTYPE');
      expect(html).toContain('</html>');
    });

    it('carries the preheader, which is what the inbox preview shows', () => {
      expect(html).toContain('Short summary for the inbox');
    });

    it('renders the title, eyebrow, subtitle, blocks and footer note', () => {
      expect(html).toContain('Your order is on its way');
      expect(html).toContain('Order update');
      expect(html).toContain('It left the seller this morning.');
      expect(html).toContain('Track it');
      expect(html).toContain('Nothing was charged.');
    });

    it('always offers a way to reach a human', () => {
      expect(html).toContain('support@yukizi.com');
    });

    it('escapes the title rather than trusting it', () => {
      const injected = renderEmail({
        preheader: 'p',
        title: '<img src=x onerror=alert(1)>',
        blocks: [],
      });
      expect(injected).not.toContain('<img src=x');
    });

    it('gives the header a solid colour behind the gradient, for Outlook', () => {
      expect(html).toContain('bgcolor=');
    });
  });

  describe('productList', () => {
    it('shows the image when there is one', () => {
      const html = productList([
        {
          name: 'Nendoroid Gojo',
          imageUrl: 'https://cdn.example.com/gojo.jpg',
          url: 'https://yukizi.com/products/gojo',
        },
      ]);
      expect(html).toContain('https://cdn.example.com/gojo.jpg');
    });

    it('falls back to a lettered tile rather than a broken image', () => {
      const html = productList([
        { name: 'Nezuko Figure', imageUrl: null, url: 'https://yukizi.com/p/n' },
      ]);
      expect(html).not.toContain('<img');
      // The tile shows the product's initial. Whitespace-insensitive, since
      // the template indents it.
      expect(html.replace(/\s+/g, '')).toContain('>N<');
    });

    it('renders nothing at all for an empty list', () => {
      expect(productList([])).toBe('');
    });

    it('escapes product names, which sellers type freely', () => {
      const html = productList([
        { name: '<b>Figure</b>', url: 'https://yukizi.com/p/x' },
      ]);
      expect(html).not.toContain('<b>Figure</b>');
    });
  });

  describe('panel and quote', () => {
    it('escapes the values it is given', () => {
      const html = panel([{ label: 'Reference', value: '<script>x</script>' }]);
      expect(html).not.toContain('<script>');
    });

    it('keeps a support reply readable without letting it inject markup', () => {
      const html = quote('Line one\nLine two <b>bold</b>', 'Aditi, Support');
      expect(html).toContain('Line one');
      expect(html).not.toContain('<b>bold</b>');
      // Newlines in the reply survive as newlines.
      expect(html).toContain('white-space:pre-wrap');
    });
  });

  describe('rupees', () => {
    it('formats the way the storefront does', () => {
      expect(rupees(20497)).toBe('₹20,497.00');
      expect(rupees(0)).toBe('₹0.00');
    });

    it('does not blow up on a missing amount', () => {
      expect(rupees(undefined as never)).toBe('₹0.00');
    });
  });
});

import { ImageRenameService } from './image-rename.service';

describe('ImageRenameService.renameProductImages', () => {
  const build = (products: unknown[], remaining = 0) => {
    const prisma = {
      catalogProduct: {
        findMany: jest.fn().mockResolvedValue(products),
        count: jest.fn().mockResolvedValue(remaining),
      },
      catalogProductImage: { update: jest.fn().mockResolvedValue({}) },
      seoMeta: {
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const storage = {
      copyObject: jest.fn(async (_old: string, newKey: string) =>
        `https://storage.googleapis.com/yukiz-bucket/${newKey}`),
    };
    const service = new ImageRenameService(prisma as never, storage as never);
    return { service, prisma, storage };
  };

  it('copies to <slug>-yukizi-<n>.<ext> in the same folder and updates the row', async () => {
    const { service, prisma, storage } = build([
      {
        id: 'prod-1',
        name: 'Goku Scale Figure!',
        images: [
          { id: 'img-1', url: 'https://storage.googleapis.com/yukiz-bucket/media/images/tmp-abc/Original_File.PNG' },
        ],
      },
    ]);

    const res = await service.renameProductImages(20);

    expect(storage.copyObject).toHaveBeenCalledWith(
      'media/images/tmp-abc/Original_File.PNG',
      'media/images/tmp-abc/goku-scale-figure-yukizi-1.png',
    );
    expect(prisma.catalogProductImage.update).toHaveBeenCalledWith({
      where: { id: 'img-1' },
      data: { url: 'https://storage.googleapis.com/yukiz-bucket/media/images/tmp-abc/goku-scale-figure-yukizi-1.png' },
    });
    expect(res.renamed).toBe(1);
  });

  it('skips already-renamed and foreign URLs without touching storage', async () => {
    const { service, prisma, storage } = build([
      {
        id: 'prod-1',
        name: 'Goku',
        images: [
          { id: 'img-1', url: 'https://storage.googleapis.com/yukiz-bucket/media/images/x/goku-yukizi-1.png' },
          { id: 'img-2', url: 'https://placehold.co/96x96' },
        ],
      },
    ]);

    const res = await service.renameProductImages(20);

    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(prisma.catalogProductImage.update).not.toHaveBeenCalled();
    expect(res.skipped).toBe(2);
  });

  it('leaves the DB untouched when the copy fails', async () => {
    const { service, prisma, storage } = build([
      {
        id: 'prod-1',
        name: 'Goku',
        images: [{ id: 'img-1', url: 'https://storage.googleapis.com/yukiz-bucket/media/images/x/a.png' }],
      },
    ]);
    (storage.copyObject as jest.Mock).mockResolvedValue(null);

    const res = await service.renameProductImages(20);

    expect(prisma.catalogProductImage.update).not.toHaveBeenCalled();
    expect(res.failed).toBe(1);
  });

  it('migrates per-image ALT override keys to the new URLs', async () => {
    const oldUrl = 'https://storage.googleapis.com/yukiz-bucket/media/images/x/a.png';
    const { service, prisma } = build([
      { id: 'prod-1', name: 'Goku', images: [{ id: 'img-1', url: oldUrl }] },
    ]);
    prisma.seoMeta.findFirst.mockResolvedValue({
      id: 'meta-1',
      imageAltOverrides: { [oldUrl]: 'My manual alt' },
    });

    await service.renameProductImages(20);

    const updated = prisma.seoMeta.update.mock.calls[0][0] as {
      data: { imageAltOverrides: Record<string, string> };
    };
    expect(Object.values(updated.data.imageAltOverrides)).toEqual(['My manual alt']);
    expect(Object.keys(updated.data.imageAltOverrides)[0]).toContain('goku-yukizi-1.png');
  });
});

describe('ImageRenameService.renameSingleImage', () => {
  const build = () => {
    const prisma = {
      catalogProduct: { findMany: jest.fn(), count: jest.fn() },
      catalogProductImage: {
        findFirst: jest.fn().mockResolvedValue({ id: 'img-1' }),
        update: jest.fn().mockResolvedValue({}),
      },
      seoMeta: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() },
    };
    const storage = {
      copyObject: jest.fn(async (_o: string, newKey: string) =>
        `https://storage.googleapis.com/yukiz-bucket/${newKey}`),
    };
    const service = new ImageRenameService(prisma as never, storage as never);
    return { service, prisma, storage };
  };
  const url = 'https://storage.googleapis.com/yukiz-bucket/media/images/x/old-name.png';

  it('slugifies the typed name, keeps the extension, updates the row', async () => {
    const { service, prisma, storage } = build();

    const res = await service.renameSingleImage('prod-1', url, 'Iron Man Helmet Front View!');

    expect(storage.copyObject).toHaveBeenCalledWith(
      'media/images/x/old-name.png',
      'media/images/x/iron-man-helmet-front-view.png',
    );
    expect(prisma.catalogProductImage.update).toHaveBeenCalled();
    expect(res.newUrl).toContain('iron-man-helmet-front-view.png');
  });

  it('refuses images that are not on the product', async () => {
    const { service, prisma, storage } = build();
    prisma.catalogProductImage.findFirst.mockResolvedValue(null);

    const res = await service.renameSingleImage('prod-1', url, 'x');

    expect(res.newUrl).toBeNull();
    expect(storage.copyObject).not.toHaveBeenCalled();
  });

  it('no-ops when the computed name equals the current one', async () => {
    const { service, storage } = build();

    const res = await service.renameSingleImage('prod-1', url, 'Old Name');

    expect(storage.copyObject).not.toHaveBeenCalled();
    expect(res.newUrl).toBe(url);
  });
});

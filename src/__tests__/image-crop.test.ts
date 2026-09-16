import { createCropTarget } from '@/lib/image-crop';

describe('image crop target', () => {
  it('uses the measured logical size as the editor aspect ratio', () => {
    expect(createCropTarget(392.4, 748.6, 2.75)).toEqual({
      aspect: [392, 749],
      outputWidth: 1079,
      outputHeight: 2059,
    });
  });

  it('rejects invalid dimensions', () => {
    expect(createCropTarget(0, 700, 3)).toBeNull();
    expect(createCropTarget(390, Number.NaN, 3)).toBeNull();
  });
});

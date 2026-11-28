// Images de cartes abîmées comme le ferait une photo au téléphone, pour mesurer la reconnaissance (avec sharp).
// Chaque transformation prend le contenu d'une image et renvoie une instance sharp.

export function degradations(sharp) {
  const raw = async (pipeline) => pipeline.raw().toBuffer({ resolveWithObject: true });
  const fromRaw = ({ data, info }) => sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } });
  async function rotate(buf, deg) {
    const { width, height } = await sharp(buf).metadata();
    const r = await raw(sharp(buf).rotate(deg, { background: '#303030' }));
    const left = Math.floor((r.info.width - width) / 2), top = Math.floor((r.info.height - height) / 2);
    return fromRaw(r).extract({ left, top, width, height });
  }
  async function margin(img, pct) {
    const buf = await img.png().toBuffer();
    const { width, height } = await sharp(buf).metadata();
    const dx = Math.round(width * pct), dy = Math.round(height * pct);
    return sharp(buf).extend({ left: dx, right: dx, top: dy, bottom: dy, background: '#202020' });
  }
  async function crop(buf, pct) {
    const { width, height } = await sharp(buf).metadata();
    const dx = Math.round(width * pct), dy = Math.round(height * pct);
    return sharp(buf).extract({ left: dx, top: dy, width: width - 2 * dx, height: height - 2 * dy });
  }
  const warm = (img) => img.linear([1.12, 1, 0.85], [0, 0, 0]);
  return [
    { key: 'origin', name: 'image d’origine', make: (b) => sharp(b) },
    { key: 'blur', name: 'flou', make: (b) => sharp(b).blur(1.5) },
    { key: 'dark', name: 'sombre (−35 %)', make: (b) => sharp(b).modulate({ brightness: 0.65 }) },
    { key: 'light', name: 'claire (+35 %)', make: (b) => sharp(b).modulate({ brightness: 1.35 }) },
    { key: 'warm', name: 'teinte chaude', make: (b) => warm(sharp(b)) },
    { key: 'small', name: 'petite et compressée', make: async (b) => sharp(await sharp(b).resize({ width: 90 }).jpeg({ quality: 35 }).toBuffer()) },
    { key: 'rotate', name: 'rotation 3°', make: (b) => rotate(b, 3) },
    { key: 'margin', name: 'marge 5 %', make: (b) => margin(sharp(b), 0.05) },
    { key: 'crop', name: 'rognée 4 %', make: (b) => crop(b, 0.04) },
    { key: 'photo', name: 'photo (tout à la fois)', make: async (b) => {
      const img = await margin(await rotate(b, 2), 0.03);
      return sharp(await warm(img.modulate({ brightness: 0.8 })).blur(1).resize({ width: 600 }).jpeg({ quality: 60 }).toBuffer());
    } },
  ];
}

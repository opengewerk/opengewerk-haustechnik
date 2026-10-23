import sharp from 'sharp'

// The photos of a round or an evidence as the printed page carries them
// (#580): made smaller before they are embedded, because every photo is part
// of the page the renderer gets, and a device keeps them at a long edge of
// 2048 pixels and up to 3 MB. At that size a round with a few dozen photos
// went past what Chromium takes (#579), and every PDF weighed as much as its
// photos. On the page a photo is 40 by 30 millimetres; 1200 pixels are still
// far above what a print or a closer look at the screen needs. The photo in
// the store stays as it was, and the state of the evidence still names it.

/** The long edge of a printed photo, in pixels. */
export const printedLongEdge = 1200

/** The JPEG quality of a printed photo: the one a device keeps its photos at. */
const printedQuality = 80

/** The pictures made smaller; anything else goes onto the page as it came. */
const scaled = new Set(['image/jpeg', 'image/png', 'image/webp'])

/** A picture as the page embeds it. */
export interface PagePicture {
  readonly mediaType: string
  readonly bytes: Uint8Array
}

/**
 * The photo at the size of the page: turned upright, at most `printedLongEdge`
 * pixels on its long edge, as JPEG on white. A photo that is smaller already,
 * of a type not made smaller, or that cannot be read comes back unchanged, so
 * that the page shows what it showed before; and so does one whose smaller
 * version would not be smaller.
 */
export async function photoForPrint(photo: PagePicture): Promise<PagePicture> {
  if (!scaled.has(photo.mediaType)) {
    return photo
  }

  try {
    const { autoOrient } = await sharp(photo.bytes).metadata()

    if (Math.max(autoOrient.width, autoOrient.height) <= printedLongEdge) {
      return photo
    }

    const bytes = await sharp(photo.bytes)
      .autoOrient()
      .resize({ width: printedLongEdge, height: printedLongEdge, fit: 'inside' })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: printedQuality })
      .toBuffer()

    return bytes.byteLength < photo.bytes.byteLength ? { mediaType: 'image/jpeg', bytes } : photo
  } catch {
    // A photo libvips cannot read: the page shows it as it did, or Chromium
    // leaves an empty frame, as before.
    return photo
  }
}

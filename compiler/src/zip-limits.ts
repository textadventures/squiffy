// A limit on how much a zip someone else made can unpack to: a .quest file, or a project zip that
// Open file reads back. A small zip can say it holds gigabytes (#644). Pass the filter to fflate's
// unzipSync: it unpacks each file into a buffer the size the zip says it is, and doesn't grow it,
// so checking those sizes caps the memory it uses.

// Far more than a story's images and sounds come to
export const MAX_UNZIPPED_BYTES = 512 * 1024 * 1024;

export class ZipTooBigError extends Error {}

/** A filter for fflate's unzipSync that throws ZipTooBigError once the files would come to more than limit */
export function unzipSizeLimit(limit = MAX_UNZIPPED_BYTES): (file: { originalSize: number }) => boolean {
    let total = 0;
    return file => {
        total += file.originalSize;
        if (total > limit) throw new ZipTooBigError(`It would unpack to more than ${Math.round(limit / 1024 / 1024)} MB.`);
        return true;
    };
}

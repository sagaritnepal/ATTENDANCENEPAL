import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

const OUTPUT_SIZE = 600; // px, matches admin-web's PhotoCropModal output size
const MAX_UPLOAD_BYTES = 1_000_000; // 1MB — same cap web already compresses to
const QUALITIES = [0.85, 0.7, 0.55, 0.4, 0.25];

/** Resizes to a fixed square (matching web's cropper output) and steps JPEG
 * quality down until under MAX_UPLOAD_BYTES, same "if more than ~1MB,
 * compress it" behavior admin-web's PhotoCropModal already applies —
 * mobile never had an equivalent, so a picked photo went to storage
 * untouched (often several MB straight from a phone camera). */
export async function compressPhoto(uri: string): Promise<string> {
  let resultUri = uri;
  for (let i = 0; i < QUALITIES.length; i++) {
    const result = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: OUTPUT_SIZE, height: OUTPUT_SIZE } }], {
      compress: QUALITIES[i],
      format: ImageManipulator.SaveFormat.JPEG,
    });
    resultUri = result.uri;
    const info = await FileSystem.getInfoAsync(resultUri, { size: true });
    const size = info.exists ? info.size : 0;
    if (size <= MAX_UPLOAD_BYTES || i === QUALITIES.length - 1) break;
  }
  return resultUri;
}

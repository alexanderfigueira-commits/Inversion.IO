import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

/**
 * The brand photo (the paper bird on the green folder). Drop the file into public/img as
 * logo-photo.webp, .jpg, .jpeg or .png and it appears on the home page. Returns its URL, or null
 * while the file is missing, in which case the page shows the Tendrelark mark in the same frame.
 */
export function findLogoPhoto() {
  for (const ext of ['webp', 'jpg', 'jpeg', 'png']) {
    if (fs.existsSync(path.join(PUBLIC_DIR, 'img', `logo-photo.${ext}`))) return `/img/logo-photo.${ext}`;
  }
  return null;
}

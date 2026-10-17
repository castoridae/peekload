import { FORMATS, isFormatId } from './formats.ts';
import { t } from './i18n.ts';

/** Translated format name; unknown ids are returned as is. */
export function formatLabel(id: string): string {
  return isFormatId(id) ? t(FORMATS[id].labelKey) : id;
}

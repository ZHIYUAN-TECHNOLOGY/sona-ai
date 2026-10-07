// pdfcn's registry references this type but does not ship it; every component extends it.
import type { ReactNode } from "react";

import type { Style } from "./pdf-primitives";

export interface PDFComponentProps {
  children?: ReactNode;
  style?: Style;
}

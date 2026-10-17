import type { Attachment } from "@/components/sona/attachments-menu";

/**
 * Attachments sent from a page with nothing to read them (Today, Ward, Messages…): Sona asks whose they are, and the
 * visit the clinician then opens adopts them, waiting above its + for the next question.
 */
// ponytail: the next visit opened adopts them, whichever it is (they show above its +, to remove); tie them to the row tapped if that misleads.
let carried: Attachment[] = [];
export const carry = (items: Attachment[]) => { carried = items; };
export const takeCarried = () => { const items = carried; carried = []; return items; };

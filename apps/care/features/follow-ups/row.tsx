import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useMe } from "@/features/me";
import { useLang } from "@/lib/i18n";
import { orpc } from "@/utils/orpc";
import { followUpNeeds } from "./lines";

/** The patient's follow-ups, earliest first, in the language Sona Care speaks, fetched once they have joined. */
export function useFollowUps() {
  const { state } = useMe();
  const lang = useLang();
  return useQuery({ ...orpc.care.followUps.queryOptions({ input: { lang } }), enabled: state === "joined", placeholderData: keepPreviousData });
}
/** The booking requests the patient sent (waiting, confirmed or declined), once they have joined. */
export function useBookingRequests() {
  const { state } = useMe();
  return useQuery({ ...orpc.care.bookings.list.queryOptions(), enabled: state === "joined" });
}
export function useFollowUpNeeds() {
  const { data } = useFollowUps();
  return followUpNeeds(data);
}

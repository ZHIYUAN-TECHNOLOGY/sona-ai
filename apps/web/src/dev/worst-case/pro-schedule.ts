import { addDays, dateKey, weekOf } from "@/features/today/time";

import { fixture } from "./fixture";

// /pro/schedule: day.list lives in pro-today.ts (shared with /pro/today). Open slots for this week and next, in the
// hospital's time; 09:00 and 14:00 also hold booked visits, so slots and visits meet in the same hour.
const days = [...weekOf(dateKey(new Date())), ...weekOf(addDays(dateKey(new Date()), 7))];
const slotsAt = (times: string[]) => days.map(date => ({ day: new Date(`${date}T00:00:00+08:00`), times: times.map(t => new Date(`${date}T${t}:00+08:00`)) }));
const doctor = { id: "d-haziq", name: "Dato' Dr Muhammad Haziq Iskandar bin Abdul Rahman", specialty: "Paediatric Cardiology and Congenital Heart Disease" };
const careTeam = [doctor, { id: "d-lim", name: "Dr Lim", specialty: "Cardiology" }];

export default [
  fixture("bookings.slots", {
    worst: { doctor, careTeam, days: slotsAt(["08:30", "09:00", "09:30", "10:00", "14:00", "14:30", "16:45"]) },
    empty: { doctor: careTeam[1]!, careTeam: [careTeam[1]!], days: [] },
    one: { doctor: careTeam[1]!, careTeam: [careTeam[1]!], days: [{ day: new Date(`${dateKey(new Date())}T00:00:00+08:00`), times: [new Date(`${dateKey(new Date())}T16:00:00+08:00`)] }] },
    huge: { doctor, careTeam, days: slotsAt(Array.from({ length: 40 }, (_, i) => `${String(7 + Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`)) },
  }),
];

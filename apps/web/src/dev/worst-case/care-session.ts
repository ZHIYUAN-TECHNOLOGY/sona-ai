import { fixture } from "./fixture";

// Who is signed in to Sona Care: every Care page needs it, so it is seeded here.
export default [
  fixture("care.me", {
    worst: {
      patientId: "9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
      name: "Siti Nur Aisyah binti Mohd Khairuddin",
      firstName: "Siti Nur Aisyah binti Mohd Khairuddin",
      hospital: "Hospital Pakar Universiti Kebangsaan Malaysia (synthetic)",
      encounterId: "enc-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
      dischargedAt: "2026-09-24T10:30:00+08:00",
    },
    one: { patientId: "p-jo", name: "Jo", firstName: "Jo", hospital: "Hospital Sungai Buloh (synthetic)", encounterId: undefined, dischargedAt: undefined },
  }),
];

import { fixture } from "./fixture";

// Who is signed in, for every Pro page. Every other procedure is registered once, in its page's own file (pro-<page>.ts);
// all files load on every page, so the sidebar badges read those too. Training data is management only, so on that page the seeded doctor signs in as management; every other page keeps the doctor.
type Me = { userId: string; name: string; email: string; role: "nurse" | "doctor" | "bed-manager" | "management"; label: string };
const me = (who: Me) => (): Me => window.location.pathname === "/pro/training-data"
  ? { ...who, role: "management", label: "Hospital Director, Clinical Governance and Quality Improvement" }
  : who;

export default [
  fixture("clinician.me", {
    worst: me({
      userId: "u-9f8e7d6c-5b4a-4c3d-8e2f-1a0b9c8d7e6f",
      name: "Dr Aleksandra Wiśniewska-Kowalczyk",
      email: "aleksandra.wisniewska-kowalczyk@hospital-pakar-ukm.example.com",
      role: "doctor",
      // ROLE_LABEL says "Doctor" today; the field is a plain string, so a hospital's own title fits here too.
      label: "Consultant Cardiothoracic and Vascular Surgeon",
    }),
    one: me({ userId: "u-jo", name: "Jo", email: "jo@example.com", role: "doctor", label: "Doctor" }),
  }),
];

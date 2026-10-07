import { fixture } from "./fixture";

// Sona Care sign-in and join. The rest of these pages' worst cases are what the patient types (long numbers,
// a pasted code) and the errors the auth server returns, tried by hand in the browser.
export default [
  // Staging's demo number and code; "empty" is production, where there is none.
  fixture("care.demoSignIn", { worst: { phone: "+601123456789", code: "482915" }, empty: null }),
  // Who a join code is for: the server sends the first word of the name, so a long single-word given name is the worst.
  fixture("care.preview", {
    worst: { firstName: "Thiruchelvanayagam", hospital: "Hospital Pakar Universiti Kebangsaan Malaysia (synthetic)" },
    one: { firstName: "Jo", hospital: "Hospital Sungai Buloh (synthetic)" },
  }),
];

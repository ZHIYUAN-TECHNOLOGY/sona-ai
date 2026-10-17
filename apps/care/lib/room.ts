/**
 * When the patient has stopped talking, on the phone (turn-by-turn voice, ./listen): a metering reading (dBFS, every
 * 100 ms) over the bar is speech. The bar is SPEECH_DB in a quiet room; a room that hums louder (10 Oct, the user's
 * iPhone: "Listening…" long after they stopped, as the hum kept breaking the 0.8 s of quiet) raises it to ABOVE_ROOM_DB
 * over the quietest reading of this recording (the room, heard between words), at most LOUD_ROOM_DB, so a voice at
 * arm's length still counts. The server's ear does the same for live calls (packages/api/src/voice-agent/listen.ts).
 */
export const SPEECH_DB = -38, ABOVE_ROOM_DB = 10, LOUD_ROOM_DB = -28;

export const speechBar = (quietest: number) => Math.max(SPEECH_DB, Math.min(quietest + ABOVE_ROOM_DB, LOUD_ROOM_DB));

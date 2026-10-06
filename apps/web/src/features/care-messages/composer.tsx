import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent, type KeyboardEvent } from "react";

import { Button } from "@/components/primitives";
import { client, orpc } from "@/lib/orpc";

import { SENDING, addSending, rollBack, settle } from "./thread";

const newRequestId = () => `web-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
type Draft = { text: string; requestId: string };

/** Write to the care team. The message shows at once; if sending fails it is taken back and the words return here. */
export function Composer() {
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  // One ID per message text, so a retry after a dropped connection is not sent twice (as the phone app does).
  const [attempt, setAttempt] = useState<Draft>({ text: "", requestId: newRequestId() });
  const key = orpc.care.messages.list.queryKey();

  const send = useMutation({
    mutationFn: (d: Draft) => client.care.messages.send(d),
    onMutate: async d => {
      await queryClient.cancelQueries({ queryKey: key });
      queryClient.setQueryData(key, old => addSending(old, { id: SENDING + d.requestId, from: "patient" as const, text: d.text, createdAt: new Date(), seenAt: null, attachment: null }));
      setText("");
    },
    onSuccess: (sent, d) => {
      queryClient.setQueryData(key, old => settle(old, d.requestId, sent));
      setAttempt({ text: "", requestId: newRequestId() });
    },
    onError: (_error, d) => {
      queryClient.setQueryData(key, old => rollBack(old, d.requestId));
      setText(d.text);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: orpc.care.messages.key() }),
  });

  const go = () => {
    const words = text.trim();
    if (!words || send.isPending) return;
    const requestId = words === attempt.text ? attempt.requestId : newRequestId();
    setAttempt({ text: words, requestId });
    send.mutate({ text: words, requestId });
  };
  const onSubmit = (e: FormEvent) => { e.preventDefault(); go(); };
  const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); go(); } };

  return (
    <form className="cm-composer" onSubmit={onSubmit}>
      <label className="cm-label" htmlFor="cm-text">Write a message</label>
      <div className="cm-compose-row">
        {/* Grows with the words (CSS field-sizing); older browsers keep two rows and scroll. */}
        <textarea id="cm-text" rows={2} maxLength={1000} placeholder="How are you feeling? What do you want to ask?" value={text} onChange={e => setText(e.target.value)} onKeyDown={onKeyDown} />
        <Button type="submit" variant="primary" icon="send" pending={send.isPending} disabled={!text.trim()}>Send</Button>
      </div>
      {send.isError ? <p className="cm-error" role="alert">Not sent. Your words are still here. Try again.</p> : null}
    </form>
  );
}

import type { Metadata } from "next";
import { Link } from "@/components/ui/link";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "../legal-page";

export const metadata: Metadata = pageMetadata({
  lang: "en",
  path: "/help",
  title: "Help",
  description: `How to add a task, find it, and use the guide in ${PRODUCT_NAME}.`,
});

const QUESTIONS = [
  {
    title: "Where does a new task go?",
    text: "It goes to the client or project, the date and the priority you set on the dropdowns, and it opens as soon as you add it. A day or a name written in the title stays in the title. It does not move the task.",
  },
  {
    title: "What can a task hold?",
    text: "From Add task, and again inside the task: a description, subtasks, notes, and a calendar event. Inside the task, Add subtask, Add note, the description and Link calendar event are on the task itself.",
  },
  {
    title: "How do I start the guide?",
    text: "Guide, in the sidebar, opens it on the Overview. You can also open it from More on the Overview, after you have skipped it.",
  },
  {
    title: `When does ${ASSISTANT_NAME} act?`,
    text: "Only when you ask, in the chat. It does not change the workspace on its own.",
  },
] as const;

export default function HelpPage() {
  return (
    <LegalPage path="/help" title="Help" lede={`${PRODUCT_NAME} keeps each client and project’s tasks, notes, calendar and mail in one place. These are the questions the first visit usually has.`}>
      {QUESTIONS.map((item) => (
        <section key={item.title}>
          <h2 className="t-group">{item.title}</h2>
          <p className="t-body">{item.text}</p>
        </section>
      ))}
      <section>
        <h2 className="t-group">Open the guide</h2>
        <p className="t-body">
          <Link className="link" href="/app?guide=1">
            Show the guide
          </Link>{" "}
          on the Overview. Privacy, cookies and terms are linked in the footer.
        </p>
      </section>
    </LegalPage>
  );
}

import type { Metadata } from "next";
import { Link } from "@/components/ui/link";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "../../legal-page";

export const metadata: Metadata = pageMetadata({
  lang: "es",
  path: "/help",
  title: "Ayuda",
  description: `Cómo agregar una tarea, encontrarla y usar la guía en ${PRODUCT_NAME}.`,
});

const QUESTIONS = [
  {
    title: "¿Dónde queda una tarea nueva?",
    text: "Queda en el cliente o proyecto, con la fecha y la prioridad elegidas en los desplegables, y se abre al agregarla. Un día o un nombre escrito en el título permanece en el título. No mueve la tarea.",
  },
  {
    title: "¿Qué puede contener una tarea?",
    text: "Desde Agregar tarea, y de nuevo dentro de la tarea: una descripción, subtareas, notas y un evento de calendario. Dentro de la tarea, Agregar subtarea, Agregar nota, la descripción y Vincular evento de calendario están en la propia tarea.",
  },
  {
    title: "¿Cómo se inicia la guía?",
    text: "Guía, en la barra lateral, la abre en el Resumen. También se puede abrir desde Más en el Resumen, después de haberla omitido.",
  },
  {
    title: `¿Cuándo actúa ${ASSISTANT_NAME}?`,
    text: "Solo cuando se le pide, en el chat. No cambia el espacio de trabajo por cuenta propia.",
  },
] as const;

export default function HelpPageEs() {
  return (
    <LegalPage
      lang="es"
      path="/help"
      title="Ayuda"
      lede={`${PRODUCT_NAME} guarda las tareas, notas, el calendario y el correo de cada cliente y proyecto en un solo lugar. Estas son las preguntas habituales de la primera visita.`}
    >
      {QUESTIONS.map((item) => (
        <section key={item.title}>
          <h2 className="t-group">{item.title}</h2>
          <p className="t-body">{item.text}</p>
        </section>
      ))}
      <section>
        <h2 className="t-group">Abrir la guía</h2>
        <p className="t-body">
          <Link className="link" href="/app?guide=1">
            Mostrar la guía
          </Link>{" "}
          en el Resumen. La privacidad, las cookies y los términos están enlazados en el pie.
        </p>
      </section>
    </LegalPage>
  );
}

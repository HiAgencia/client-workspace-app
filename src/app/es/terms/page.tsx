import type { Metadata } from "next";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "../../legal-page";

export const metadata: Metadata = pageMetadata({
  lang: "es",
  path: "/terms",
  title: "Términos",
  description: `Cómo se puede usar ${PRODUCT_NAME} y para qué sirve una cuenta conectada.`,
});

export default function TermsPageEs() {
  return (
    <LegalPage
      lang="es"
      path="/terms"
      title="Términos"
      lede={`Estos términos cubren el uso de ${PRODUCT_NAME}. El espacio de trabajo pertenece a quien lo usa. Una cuenta conectada se usa para el calendario y el correo conectados, y para nada más.`}
    >
      <section>
        <h2 className="t-group">El espacio de trabajo</h2>
        <p className="t-body">
          Se conservan los clientes, proyectos, tareas, notas y eventos agregados. La demostración son datos de muestra en su propia sesión. No es una cuenta ni una promesa sobre un cliente en particular.
        </p>
      </section>
      <section>
        <h2 className="t-group">Una cuenta conectada</h2>
        <p className="t-body">
          Al conectar Google, el espacio de trabajo puede leer y cambiar los eventos de calendario de esa cuenta, y leer su correo, para que ambos puedan estar junto al trabajo al que pertenecen. La cuenta se puede desconectar en Ajustes. Conviene no conectar una cuenta sin autorización para usarla.
        </p>
      </section>
      <section>
        <h2 className="t-group">{ASSISTANT_NAME}</h2>
        <p className="t-body">El chat actúa solo a pedido. No decide por la persona y no funciona en su ausencia.</p>
      </section>
      <section>
        <h2 className="t-group">El servicio</h2>
        <p className="t-body">
          {PRODUCT_NAME} es desarrollado por {AGENCY_NAME} para la Meta Global AI Developer Hackathon. El servicio puede cambiar. Una consulta sobre estos términos se dirige a{" "}
          <a className="link" href={AGENCY_URL} target="_blank" rel="noopener">
            {AGENCY_NAME}
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}

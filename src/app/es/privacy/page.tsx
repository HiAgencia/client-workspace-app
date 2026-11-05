import type { Metadata } from "next";
import { Link } from "@/components/ui/link";
import { AGENCY_NAME, AGENCY_URL } from "@/lib/agency";
import { ASSISTANT_NAME, PRODUCT_NAME } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "../../legal-page";

export const metadata: Metadata = pageMetadata({
  lang: "es",
  path: "/privacy",
  title: "Privacidad",
  description: `Qué guarda ${PRODUCT_NAME}, para qué se usa una cuenta conectada y cómo se retira.`,
});

export default function PrivacyPageEs() {
  return (
    <LegalPage
      lang="es"
      path="/privacy"
      title="Privacidad"
      lede={`${PRODUCT_NAME} guarda lo que se pone en el espacio de trabajo y lo que un inicio de sesión o una cuenta conectada necesita para funcionar. Esta es esa lista.`}
    >
      <section>
        <h2 className="t-group">El inicio de sesión</h2>
        <p className="t-body">
          Al iniciar sesión con Google, el espacio de trabajo recibe el nombre, el correo y la foto, para que la barra lateral y el perfil puedan mostrarlos. La sesión que mantiene el ingreso es una cookie. La demostración es una sesión aparte con datos de muestra, no la cuenta de Google.
        </p>
      </section>
      <section>
        <h2 className="t-group">Lo que se escribe</h2>
        <p className="t-body">
          Los clientes, proyectos, tareas, descripciones, notas, subtareas y eventos creados permanecen en el espacio de trabajo. Una cuenta de Google conectada también puede leer y cambiar los eventos de calendario de esa cuenta, y leer su correo, para que el espacio de trabajo pueda mostrarlos junto al trabajo al que pertenecen. El token de esa cuenta se guarda cifrado en el servidor. La cuenta se desconecta en Ajustes.
        </p>
      </section>
      <section>
        <h2 className="t-group">{ASSISTANT_NAME}</h2>
        <p className="t-body">
          El chat funciona solo cuando se le pide. Lo enviado en ese turno llega al modelo que responde. No actúa en el espacio de trabajo por cuenta propia.
        </p>
      </section>
      <section>
        <h2 className="t-group">En este navegador</h2>
        <p className="t-body">
          Este navegador recuerda el tema, el idioma elegido en las páginas públicas, si se descartó la oferta de la versión en español, si ya se vio la guía y el último lugar abierto, para que la visita siguiente pueda continuar ahí. No son cookies de publicidad. La lista está en la página de <Link href="/es/cookies">Cookies</Link>.
        </p>
      </section>
      <section>
        <h2 className="t-group">Una consulta sobre esto</h2>
        <p className="t-body">
          {PRODUCT_NAME} es desarrollado por {AGENCY_NAME}. Una consulta sobre lo que se guarda se dirige a{" "}
          <a className="link" href={AGENCY_URL} target="_blank" rel="noopener">
            {AGENCY_NAME}
          </a>
          .
        </p>
      </section>
    </LegalPage>
  );
}

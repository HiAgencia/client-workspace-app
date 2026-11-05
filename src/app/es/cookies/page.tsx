import type { Metadata } from "next";
import { PRODUCT_NAME } from "@/lib/product";
import { pageMetadata } from "@/lib/seo";
import { LegalPage } from "../../legal-page";

export const metadata: Metadata = pageMetadata({
  lang: "es",
  path: "/cookies",
  title: "Cookies",
  description: `Las cookies y las elecciones guardadas que usa ${PRODUCT_NAME}, y las que no usa.`,
});

export default function CookiesPageEs() {
  return (
    <LegalPage
      lang="es"
      path="/cookies"
      title="Cookies"
      lede={`${PRODUCT_NAME} no coloca cookies de publicidad ni de analítica. Lo que guarda es lo que el espacio de trabajo necesita para mantener el ingreso y recordar una elección realizada.`}
    >
      <section>
        <h2 className="t-group">La sesión</h2>
        <p className="t-body">
          Al iniciar sesión se coloca una cookie de sesión, para que la página siguiente siga sabiendo de quién se trata. Al conectar una cuenta de Google se coloca una cookie breve para ese paso, para que el regreso desde Google coincida con el navegador que lo inició. Ambas desaparecen cuando termina la sesión o el paso.
        </p>
      </section>
      <section>
        <h2 className="t-group">Elecciones guardadas en este navegador</h2>
        <p className="t-body">
          El tema, el idioma elegido en las páginas públicas, el descarte de la oferta de la versión en español, si ya se vio la guía y el último lugar abierto se guardan en el almacenamiento de este navegador. No se envían a una red de publicidad. Al borrar los datos del navegador para este sitio se eliminan, y la visita siguiente vuelve a preguntar donde corresponda.
        </p>
      </section>
      <section>
        <h2 className="t-group">Lo que no está aquí</h2>
        <p className="t-body">
          No hay cookie de medición ni de publicidad. Si se agrega alguna más adelante, esta página lo dirá antes de que se coloque.
        </p>
      </section>
    </LegalPage>
  );
}

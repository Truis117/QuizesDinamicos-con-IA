import { useEffect } from "react";

type SeoConfig = {
  title: string;
  description: string;
  path?: string;
  imagePath?: string;
  robots?: string;
};

function upsertMetaByName(name: string, content: string) {
  let element = document.head.querySelector(`meta[name="${name}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("name", name);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertMetaByProperty(property: string, content: string) {
  let element = document.head.querySelector(`meta[property="${property}"]`) as HTMLMetaElement | null;
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute("property", property);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function upsertCanonical(url: string) {
  let element = document.head.querySelector("link[rel='canonical']") as HTMLLinkElement | null;
  if (!element) {
    element = document.createElement("link");
    element.setAttribute("rel", "canonical");
    document.head.appendChild(element);
  }
  element.setAttribute("href", url);
}

export function useSeo(config: SeoConfig) {
  useEffect(() => {
    const origin = window.location.origin;
    const path = config.path ?? window.location.pathname;
    const canonicalUrl = new URL(path, origin).toString();
    const imagePath = config.imagePath ?? "/og-cover.svg";
    const imageUrl = new URL(imagePath, origin).toString();

    document.title = config.title;
    upsertMetaByName("description", config.description);
    upsertMetaByName("robots", config.robots ?? "index,follow");

    upsertMetaByProperty("og:type", "website");
    upsertMetaByProperty("og:site_name", "QuizDinamico AI");
    upsertMetaByProperty("og:title", config.title);
    upsertMetaByProperty("og:description", config.description);
    upsertMetaByProperty("og:url", canonicalUrl);
    upsertMetaByProperty("og:image", imageUrl);

    upsertMetaByName("twitter:card", "summary_large_image");
    upsertMetaByName("twitter:title", config.title);
    upsertMetaByName("twitter:description", config.description);
    upsertMetaByName("twitter:image", imageUrl);

    upsertCanonical(canonicalUrl);
  }, [config.description, config.imagePath, config.path, config.robots, config.title]);
}

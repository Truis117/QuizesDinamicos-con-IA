import express, { Express, NextFunction, Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { z } from "zod";
import { env } from "./config/env.js";
import { logger } from "./lib/logger.js";
import { authRouter } from "./routes/auth.routes.js";
import { sessionRouter } from "./routes/session.routes.js";
import { publicRouter } from "./routes/public.routes.js";
import { SessionService } from "./services/session.service.js";

type RateCounter = {
  count: number;
  resetAt: number;
};

type SeoPayload = {
  title: string;
  description: string;
  canonicalPath: string;
  robots?: "index,follow" | "noindex,follow";
  schemaJson?: string;
  rootHtml?: string;
};

const rateLimitStore = new Map<string, RateCounter>();
const sessionService = new SessionService();
const PUBLIC_SSR_QUESTION_LIMIT = 10;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const frontendDist = path.join(__dirname, "../../frontend/dist");
const frontendIndexPath = path.join(frontendDist, "index.html");
let frontendTemplateCache: string | null = null;

type PublicSessionView = NonNullable<Awaited<ReturnType<SessionService["getPublicSession"]>>>;

function buildRateKey(req: Request): string {
  const forwarded = req.header("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || req.ip || "unknown";
  return ip;
}

function cleanupRateLimitStore() {
  const now = Date.now();
  for (const [key, counter] of rateLimitStore.entries()) {
    if (counter.resetAt <= now) {
      rateLimitStore.delete(key);
    }
  }
}

function apiRateLimiter(req: Request, res: Response, next: NextFunction) {
  cleanupRateLimitStore();

  const key = buildRateKey(req);
  const now = Date.now();
  const windowMs = env.API_RATE_LIMIT_WINDOW_SEC * 1000;

  const current = rateLimitStore.get(key);
  if (!current || current.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs
    });
    next();
    return;
  }

  if (current.count >= env.API_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((current.resetAt - now) / 1000);
    res.setHeader("Retry-After", String(Math.max(retryAfter, 1)));
    res.status(429).json({
      error: "Too many requests",
      retryAfterSec: Math.max(retryAfter, 1)
    });
    return;
  }

  current.count += 1;
  next();
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeHtmlText(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("'", "&#39;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function escapeHtmlAttr(value: string) {
  return escapeHtmlText(value);
}

function upsertMetaByName(html: string, name: string, content: string) {
  const escapedName = escapeRegex(name);
  const tag = `<meta name="${name}" content="${escapeHtmlAttr(content)}" />`;
  const pattern = new RegExp(`<meta\\s+[^>]*name=["']${escapedName}["'][^>]*>`, "i");

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `  ${tag}\n</head>`);
}

function upsertMetaByProperty(html: string, property: string, content: string) {
  const escapedProperty = escapeRegex(property);
  const tag = `<meta property="${property}" content="${escapeHtmlAttr(content)}" />`;
  const pattern = new RegExp(
    `<meta\\s+[^>]*property=["']${escapedProperty}["'][^>]*>`,
    "i"
  );

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `  ${tag}\n</head>`);
}

function upsertCanonical(html: string, canonicalUrl: string) {
  const tag = `<link rel="canonical" href="${escapeHtmlAttr(canonicalUrl)}" />`;
  const pattern = /<link\s+[^>]*rel=["']canonical["'][^>]*>/i;

  if (pattern.test(html)) {
    return html.replace(pattern, tag);
  }

  return html.replace("</head>", `  ${tag}\n</head>`);
}

function upsertSchema(html: string, schemaJson?: string) {
  const schemaPattern =
    /<script\s+[^>]*id=["']app-schema["'][^>]*>[\s\S]*?<\/script>/i;

  if (!schemaJson) {
    return html.replace(schemaPattern, "");
  }

  const scriptTag = `<script id="app-schema" type="application/ld+json">${schemaJson}</script>`;

  if (schemaPattern.test(html)) {
    return html.replace(schemaPattern, scriptTag);
  }

  return html.replace("</head>", `  ${scriptTag}\n</head>`);
}

function getFrontendTemplate() {
  if (frontendTemplateCache) return frontendTemplateCache;
  frontendTemplateCache = fs.readFileSync(frontendIndexPath, "utf8");
  return frontendTemplateCache;
}

function renderPublicQuizRootHtml(session: PublicSessionView) {
  const orderedQuestions = session.rounds
    .flatMap((round) =>
      round.questions.map((question) => ({
        question,
        roundIndex: round.roundIndex
      }))
    )
    .sort((a, b) => {
      if (a.roundIndex !== b.roundIndex) {
        return a.roundIndex - b.roundIndex;
      }
      return a.question.orderIndex - b.question.orderIndex;
    })
    .map((entry) => entry.question);

  const visibleQuestions = orderedQuestions.slice(0, PUBLIC_SSR_QUESTION_LIMIT);

  const cards = visibleQuestions
    .map((question, index) => {
      const options = Object.entries(question.options as Record<string, string>)
        .map(
          ([label, text]) =>
            `<li><strong>${escapeHtmlText(label)}.</strong> ${escapeHtmlText(String(text))}</li>`
        )
        .join("");

      return `<article><h2>${index + 1}. ${escapeHtmlText(question.questionText)}</h2><ul>${options}</ul></article>`;
    })
    .join("");

  return `<section aria-label="Quiz publico"><h1>${escapeHtmlText(
    session.topic
  )}</h1><p>${orderedQuestions.length} preguntas generadas por IA.</p>${cards}</section>`;
}

function renderFrontendWithSeo(payload: SeoPayload) {
  const canonicalUrl = `${env.PUBLIC_SITE_URL}${payload.canonicalPath}`;
  const imageUrl = `${env.PUBLIC_SITE_URL}/og-cover.svg`;
  let html = getFrontendTemplate();

  const titleTag = `<title>${escapeHtmlAttr(payload.title)}</title>`;
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, titleTag);
  } else {
    html = html.replace("</head>", `  ${titleTag}\n</head>`);
  }

  html = upsertMetaByName(html, "description", payload.description);
  html = upsertMetaByName(html, "robots", payload.robots ?? "index,follow");

  html = upsertMetaByProperty(html, "og:type", "website");
  html = upsertMetaByProperty(html, "og:site_name", "QuizDinamico AI");
  html = upsertMetaByProperty(html, "og:title", payload.title);
  html = upsertMetaByProperty(html, "og:description", payload.description);
  html = upsertMetaByProperty(html, "og:url", canonicalUrl);
  html = upsertMetaByProperty(html, "og:image", imageUrl);

  html = upsertMetaByName(html, "twitter:card", "summary_large_image");
  html = upsertMetaByName(html, "twitter:title", payload.title);
  html = upsertMetaByName(html, "twitter:description", payload.description);
  html = upsertMetaByName(html, "twitter:image", imageUrl);

  html = upsertCanonical(html, canonicalUrl);
  html = upsertSchema(html, payload.schemaJson);

  if (payload.rootHtml) {
    html = html.replace('<div id="root"></div>', `<div id="root">${payload.rootHtml}</div>`);
  }

  return html;
}

function generateSitemapXml() {
  const urls = [
    {
      loc: `${env.PUBLIC_SITE_URL}/`,
      changefreq: "weekly",
      priority: "1.0"
    },
    {
      loc: `${env.PUBLIC_SITE_URL}/login`,
      changefreq: "monthly",
      priority: "0.5"
    }
  ];

  const body = urls
    .map(
      (url) =>
        `  <url><loc>${url.loc}</loc><changefreq>${url.changefreq}</changefreq><priority>${url.priority}</priority></url>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>`;
}

function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

export const app: Express = express();

app.use(helmet());
app.use(
  cors({
    origin: env.FRONTEND_ORIGIN,
    credentials: true
  })
);
app.use(express.json());
app.use(pinoHttp({ logger }));
app.use("/api", apiRateLimiter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/robots.txt", (_req, res) => {
  res.type("text/plain");
  res.send(`User-agent: *\nAllow: /\nSitemap: ${env.PUBLIC_SITE_URL}/sitemap.xml`);
});

app.get("/sitemap.xml", (_req, res) => {
  res.type("application/xml");
  res.send(generateSitemapXml());
});

app.use("/api/auth", authRouter);
app.use("/api/sessions", sessionRouter);
app.use("/api/public", publicRouter);

app.all(/^\/api(?:\/.*)?$/, (_req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

if (env.NODE_ENV === "production") {
  app.use(express.static(frontendDist, { index: false }));

  app.get(/^\/quiz\/([^/]+)(?:\/([A-Za-z0-9-]+))?$/, async (req, res, next) => {
    try {
      const sessionId = req.params[0] as string;
      const slugInPath = req.params[1] as string | undefined;
      const session = await sessionService.getPublicSession(sessionId);

      if (!session) {
        const html = renderFrontendWithSeo({
          title: "Quiz no encontrado | QuizDinamico AI",
          description: "No encontramos el quiz solicitado.",
          canonicalPath: `/quiz/${encodeURIComponent(sessionId)}`,
          robots: "noindex,follow"
        });
        res.status(404).type("html").send(html);
        return;
      }

      const slug = slugify(session.topic);
      const canonicalPath = `/quiz/${encodeURIComponent(sessionId)}/${slug}`;

      if (!slugInPath || slugInPath !== slug) {
        res.redirect(301, canonicalPath);
        return;
      }

      const html = renderFrontendWithSeo({
        title: `${session.topic} | Quiz publico - QuizDinamico AI`,
        description: `Practica ${session.topic} con preguntas generadas por IA en un quiz publico.`,
        canonicalPath,
        schemaJson: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Quiz",
          name: `Quiz de ${session.topic}`,
          about: session.topic,
          inLanguage: "es",
          isAccessibleForFree: true,
          url: `${env.PUBLIC_SITE_URL}${canonicalPath}`,
          creator: {
            "@type": "Organization",
            name: "QuizDinamico AI"
          }
        }),
        rootHtml: renderPublicQuizRootHtml(session)
      });

      res.type("html").send(html);
    } catch (err) {
      next(err);
    }
  });

  app.get("/", (_req, res) => {
    const html = renderFrontendWithSeo({
      title: "QuizDinamico AI | Cuestionarios con IA",
      description:
        "Genera quizzes al instante, aprende con dificultad adaptativa y refuerza conceptos con feedback en tiempo real.",
      canonicalPath: "/",
      schemaJson: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "QuizDinamico AI",
        applicationCategory: "EducationalApplication",
        operatingSystem: "Web",
        offers: {
          "@type": "Offer",
          price: "0",
          priceCurrency: "USD"
        }
      })
    });
    res.type("html").send(html);
  });

  app.get("/login", (_req, res) => {
    const html = renderFrontendWithSeo({
      title: "Iniciar sesion | QuizDinamico AI",
      description: "Accede para crear sesiones y practicar con quizzes generados por IA.",
      canonicalPath: "/login",
      robots: "noindex,follow"
    });
    res.type("html").send(html);
  });

  app.get("/app", (_req, res) => {
    const html = renderFrontendWithSeo({
      title: "Dashboard | QuizDinamico AI",
      description: "Panel privado para crear sesiones y practicar con cuestionarios de IA.",
      canonicalPath: "/app",
      robots: "noindex,follow"
    });
    res.type("html").send(html);
  });

  app.get(/.*/, (_req, res) => {
    const html = renderFrontendWithSeo({
      title: "QuizDinamico AI | Cuestionarios con IA",
      description: "Cuestionarios interactivos generados por IA.",
      canonicalPath: "/"
    });
    res.type("html").send(html);
  });
}

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof z.ZodError) {
    res.status(400).json({ error: "Validation Error", details: err.errors });
    return;
  }

  logger.error(err);
  res.status(500).json({ error: "Internal Server Error" });
});

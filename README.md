# QuizDinámico AI - Hackaton CubePath 2026

## 📖 Descripción
QuizDinámico AI es una aplicación web full-stack de aprendizaje interactivo gamificado. El usuario introduce un tema de su interés y la aplicación, conectada a un LLM de alta velocidad (vía OpenRouter), genera un cuestionario de opción múltiple en tiempo real mediante streaming (SSE). 

La plataforma mantiene un historial de sesiones, gestiona un sistema de puntuación global y ajusta dinámicamente la dificultad según el progreso y rendimiento del usuario, ofreciendo feedback y explicaciones creativas al instante.

## 🚀 Demo
[Enlace a la demo] <!-- TODO: Añadir enlace a la demo aquí -->

## 📸 Capturas / GIFs
<!-- TODO: Añadir capturas de pantalla o GIFs de la aplicación aquí -->
![Captura de pantalla principal]()

## 🛠️ Cómo se ha utilizado CubePath
En el desarrollo de **QuizDinámico AI**, hemos integrado la infraestructura y herramientas de **CubePath** de la siguiente manera:

- **Despliegue PaaS (Dockploy):** Hemos configurado nuestro monorepo (Frontend en React + Backend en Node.js) para que se despliegue de forma unificada utilizando el flujo Git-to-Deploy en un VPS, sirviendo los estáticos desde Express en producción.
- **Persistencia (PostgreSQL):** Aprovechamos los contenedores y la base de datos gestionada del entorno proporcionado para mantener un registro histórico de las sesiones, intentos y progreso adaptativo mediante Prisma ORM.
- **Foco en el Negocio:** Al utilizar la automatización y herramientas de infraestructura ofrecidas en la Hackaton, pudimos concentrar nuestros esfuerzos en el desafío técnico principal: la generación en tiempo real y tipada (SSE) de cuestionarios utilizando IA de alta velocidad (OpenRouter) sin preocuparnos por devops complejos.

## 💻 Stack Tecnológico
- **Frontend:** React, TypeScript, Vite.
- **Backend:** Node.js, Express, Zod (Validaciones).
- **Base de Datos:** PostgreSQL (Prisma).
- **IA:** OpenRouter (Streaming de eventos NDJSON).
- **Infraestructura:** Dockploy, Pnpm Workspaces.

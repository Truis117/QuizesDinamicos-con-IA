### 📛 Nombre del proyecto

**QuizDinamico AI**

### 📝 Descripción del proyecto

Es una plataforma interactiva de aprendizaje adaptativo impulsada por IA. Permite a los usuarios generar cuestionarios (quizzes) de opción múltiple al instante sobre **cualquier tema** imaginable.

Lo he desarrollado para explorar casos de uso reales de IA combinados con UX moderna, reduciendo drásticamente los tiempos de espera y gamificando el aprendizaje:
- **Streaming Inteligente (SSE):** No hay que esperar a que el LLM termine de pensar. Las preguntas llegan en tiempo real y se "teclean" en pantalla, parseando NDJSON en el aire.
- **Dificultad Adaptativa:** El nivel sube o baja (Fácil, Media, Difícil) según tus aciertos por subtema, asegurando un aprendizaje efectivo.
- **Alta Disponibilidad:** Tiene un sistema de cascada. Si falla el modelo principal (OpenRouter), entra un modelo secundario ultrarrápido (Cerebras) para que el juego nunca se detenga.
- **Gamificación:** Sistema de rachas, feedback inmediato de *por qué* fallaste o acertaste cada opción, y celebraciones visuales.

La idea a futuro (v2.0) es permitir subir PDFs o apuntes de clase para que la IA extraiga los conceptos y te evalúe exclusivamente sobre esos textos. ¡Espero que les guste este MVP funcional!

### 🔗 URL de la demo (desplegada en CubePath)

[AÑADIR_ENLACE_AQUI] (ej. https://quizdinamico.tudominio.com)

### 📦 URL del repositorio (público)

[AÑADIR_ENLACE_DEL_REPO_AQUI]

### 📸 Capturas de pantalla

*(Adjuntar capturas aquí)*
<br><br><br>

### ☁️ ¿Cómo has utilizado CubePath?

Utilizo su VPS para alojar el proyecto completo (Desplegado fácilmente gracias a Docker/Dokploy). El servidor aloja:
- Una base de datos **PostgreSQL** para persistir el historial, las rachas y la maestría por temas.
- Un backend en **Node.js (Express)** que requiere de buena capacidad de cómputo para procesar concurrentemente e hidratar múltiples conexiones persistentes (Server-Sent Events) hacia los clientes mientras gestiona los streams en tiempo real de los LLMs.
- El frontend optimizado en **React + Vite** servido desde el mismo entorno. 

El hardware del VPS de CubePath se encarga de manejar todo este flujo asíncrono y las bases de datos relacionales sin sudar.

### ✅ Confirmación

- [x] Mi proyecto está desplegado en CubePath y funciona correctamente
- [x] El repositorio es público y contiene un README con la documentación
- [x] He leído y acepto las reglas de la hackatón

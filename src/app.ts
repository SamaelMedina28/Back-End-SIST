import express, { type Application } from "express";
import cookieParser from "cookie-parser";
import cors from "cors";
import apiRouter from "./routes/index.js";

const app: Application = express();

// Middlewares globales
app.use(cors({
    origin: process.env.NODE_ENV === "production" ? process.env.FRONTEND_URL : "*",
    credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Montaje de las rutas principales (ej: http://localhost:3000/api/users)
app.use("/api", apiRouter);

// Manejo básico de rutas no encontradas (404)
app.use((req, res) => {
    res.status(404).json({ message: "Route not found" });
});

export default app;

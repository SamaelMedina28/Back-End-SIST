import { Router, type Router as ExpressRouter } from "express";
import authRoutes from "../modules/auth/auth.routes.js"
import userRoutes from "../modules/user/user.routes.js"
const apiRouter: ExpressRouter = Router();

// Registro de rutas por módulo
apiRouter.use("/auth", authRoutes);
apiRouter.use("/users", userRoutes);

// Puedes añadir más módulos aquí a medida que los generes con Vane
// apiRouter.use("/products", productRoutes);

export default apiRouter;

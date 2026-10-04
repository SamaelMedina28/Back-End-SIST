-- CreateTable
CREATE TABLE "Uber" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "destino" TEXT NOT NULL,
    "precio" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Uber_pkey" PRIMARY KEY ("id")
);

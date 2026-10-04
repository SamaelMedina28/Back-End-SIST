-- CreateTable
CREATE TABLE "Libro" (
    "id" SERIAL NOT NULL,
    "titulo" TEXT NOT NULL,
    "autor" TEXT,
    "editorial" TEXT,
    "anioPublicacion" INTEGER,

    CONSTRAINT "Libro_pkey" PRIMARY KEY ("id")
);

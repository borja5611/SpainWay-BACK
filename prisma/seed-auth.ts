import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";

async function main() {
  const email = "demo@spainway.com";
  const nombreUsuario = "demo";
  const passwordPlano = "123456";
  const passwordHash = await bcrypt.hash(passwordPlano, 10);

  const existe = await prisma.usuario.findUnique({
    where: { email },
  });

  if (!existe) {
    const usuario = await prisma.usuario.create({
      data: {
        nombre: "Usuario Demo",
        nombre_usuario: nombreUsuario,
        email,
        contrasena: passwordHash,
        telefono: "+34600000000",
        rol: "user",
        creado: new Date(),
        actualizado: new Date(),
      },
    });

    await prisma.pref_usuario.create({
      data: {
        id_usuario: usuario.id_usuario,
        presupuesto: 2,
        modo_transporte: "coche",
        accesibilidad: "media",
        con_ninos: false,
        estilo_viaje: "cultural",
        intereses: "museos,patrimonio,naturaleza",
      },
    });

    console.log("✅ Usuario demo creado");
    console.log("Email:", email);
    console.log("Usuario:", nombreUsuario);
    console.log("Password:", passwordPlano);
  } else {
    console.log("ℹ️ El usuario demo ya existía");
  }
}

main()
  .catch((e) => {
    console.error("❌ Error en seed-auth:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
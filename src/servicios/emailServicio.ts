import nodemailer from "nodemailer";

type EnviarCorreoRecuperacionParams = {
  to: string;
  codigo: string;
  nombre?: string | null;
};

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? 587);
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    throw new Error("Configuración SMTP incompleta.");
  }

  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: {
      user,
      pass,
    },
  });
}

export async function enviarCorreoRecuperacionPassword({
  to,
  codigo,
  nombre,
}: EnviarCorreoRecuperacionParams) {
  const transporter = getTransporter();

  const from = process.env.SMTP_FROM ?? `"SpainWay" <no-reply@spainway.app>`;

  await transporter.sendMail({
    from,
    to,
    subject: "Código de recuperación de contraseña - SpainWay",
    html: `
      <div style="margin:0;padding:0;background:#f3f5f9;font-family:Arial,sans-serif;color:#111827;">
        <div style="max-width:540px;margin:0 auto;padding:32px 18px;">
          <div style="background:#ffffff;border-radius:28px;padding:32px;box-shadow:0 18px 48px rgba(15,23,42,0.10);">
            <div style="text-align:center;margin-bottom:24px;">
              <div style="display:inline-block;padding:10px 16px;border-radius:999px;background:#fff4ef;color:#ff5a36;font-weight:800;">
                SpainWay
              </div>
            </div>

            <h1 style="font-size:24px;line-height:1.25;margin:0 0 14px;text-align:center;">
              Recupera tu contraseña
            </h1>

            <p style="font-size:15px;line-height:1.7;color:#667085;text-align:center;margin:0 0 24px;">
              Hola${nombre ? ` ${nombre}` : ""}, usa este código para crear una nueva contraseña.
            </p>

            <div style="text-align:center;margin:28px 0;">
              <div style="display:inline-block;background:#fff4ef;color:#ff5a36;border-radius:20px;padding:18px 26px;font-size:34px;font-weight:900;letter-spacing:8px;">
                ${codigo}
              </div>
            </div>

            <p style="font-size:14px;line-height:1.7;color:#667085;text-align:center;margin:0;">
              El código caduca en unos minutos. Si no has solicitado este cambio, puedes ignorar este correo.
            </p>

            <div style="height:1px;background:#edf0f4;margin:28px 0;"></div>

            <p style="font-size:12px;line-height:1.6;color:#98a2b3;text-align:center;margin:0;">
              SpainWay · Explora España con itinerarios inteligentes.
            </p>
          </div>
        </div>
      </div>
    `,
  });
}
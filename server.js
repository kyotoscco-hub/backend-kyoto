import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOLD_API_KEY = process.env.BOLD_API_KEY;

// ✅ Ruta de prueba
app.get("/", (req, res) => {
  res.send("Backend Kyoto funcionando 🚀");
});

// ✅ PRODUCTOS DESDE GOOGLE SHEETS (SIN MODIFICAR ESTRUCTURA)
app.get("/productos", async (req, res) => {
  try {
    const response = await fetch("https://script.google.com/macros/s/AKfycbzOx-uAUH3p3lM4i5VcISIYNOl_9D_gzhmv25-lf-Vq6V8NCOaJDE0i-yg7_3aYN0rW/exec");

    const data = await response.json();

    // 🔥 IMPORTANTE: devolvemos tal cual (para que tus tallas funcionen como antes)
    res.json(data);

  } catch (error) {
    console.error("Error obteniendo productos:", error);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

// ✅ CREAR PAGO CON BOLD
app.post("/crear-pago", async (req, res) => {
  try {
    const { carrito } = req.body;

    const total = carrito.reduce(
      (acc, item) => acc + item.precio * item.cantidad,
      0
    );

    const response = await fetch("https://api.bold.co/v1/payments", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BOLD_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: total * 100,
        currency: "COP",
        description: "Compra tienda Kyoto",
        reference: "pedido-" + Date.now(),
        redirect_url: "https://tudominio.com/gracias.html"
      })
    });

    const data = await response.json();

    res.json({ urlPago: data.payment_url });

  } catch (error) {
    console.error("Error en pago:", error);
    res.status(500).json({ error: "Error creando pago" });
  }
});

// ✅ IMPORTANTE PARA RAILWAY
app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto " + PORT);
});

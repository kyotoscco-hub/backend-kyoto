import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

app.get("/", (req, res) => res.send("Backend Kyoto con Mercado Pago 🚀"));

app.get("/productos", async (req, res) => {
  try {
    const response = await fetch("https://script.google.com/macros/s/AKfycbzOx-uAUH3p3lM4i5VcISIYNOl_9D_gzhmv25-lf-Vq6V8NCOaJDE0i-yg7_3aYN0rW/exec");
    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error("Error productos:", error);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

app.post("/crear-preferencia", async (req, res) => {
  try {
    const { carrito, datosCliente } = req.body;

    if (!carrito || carrito.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    if (!MP_ACCESS_TOKEN) {
      console.error("❌ MP_ACCESS_TOKEN no configurado");
      return res.status(500).json({ error: "Token de Mercado Pago no configurado" });
    }

    const items = carrito.map(item => ({
      title: item.nombre,
      quantity: Number(item.cantidad),
      unit_price: Number(item.precio),
      currency_id: "COP"
    }));

    const preference = {
      items,
      payer: {
        name: datosCliente?.nombreCompleto || "Cliente",
        email: datosCliente?.email || "test@test.com"
      },
      back_urls: {
        success: "https://still-bar-8cb0.kyotosc-co.workers.dev/gracias.html",
        failure: "https://still-bar-8cb0.kyotosc-co.workers.dev/error.html",
        pending: "https://still-bar-8cb0.kyotosc-co.workers.dev/pendiente.html"
      },
      auto_return: "approved"
    };

    console.log("📤 Enviando a MP:", JSON.stringify(preference, null, 2));

    const response = await fetch("https://api.mercadopago.com/checkout/preferences", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(preference)
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("❌ Error MP:", data);
      return res.status(500).json({ error: data.message || "Error al crear preferencia", details: data });
    }

    if (!data.init_point) {
      console.error("❌ No init_point:", data);
      return res.status(500).json({ error: "No se pudo crear el pago", details: data });
    }

    res.json({ init_point: data.init_point });

  } catch (error) {
    console.error("❌ Error en servidor:", error);
    res.status(500).json({ error: "Error creando preferencia", details: error.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`Servidor en puerto ${PORT}`));

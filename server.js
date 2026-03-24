import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

// 🔒 Restringir CORS a tus dominios
const allowedOrigins = [
  'https://still-bar-8cb0.kyotosc-co.workers.dev',
  'https://kyotosc.co', // si tienes dominio personalizado
  'http://localhost:5500' // para desarrollo local
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('CORS no permitido'));
    }
  }
}));
app.use(express.json());

const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;

// URL de Google Sheets (obtener productos)
const PRODUCTOS_URL = "https://script.google.com/macros/s/AKfycbzOx-uAUH3p3lM4i5VcISIYNOl_9D_gzhmv25-lf-Vq6V8NCOaJDE0i-yg7_3aYN0rW/exec";

// Cache simple de productos (para evitar llamar a Sheets en cada creación de preferencia)
let productosCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos

async function obtenerProductos() {
  if (productosCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
    return productosCache;
  }
  const res = await fetch(PRODUCTOS_URL);
  const data = await res.json();
  productosCache = data;
  cacheTimestamp = Date.now();
  return data;
}

// Endpoint para obtener productos (público)
app.get("/productos", async (req, res) => {
  try {
    const productos = await obtenerProductos();
    res.json(productos);
  } catch (error) {
    console.error("Error productos:", error);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

// Endpoint para crear preferencia (seguro)
app.post("/crear-preferencia", async (req, res) => {
  try {
    const { carrito, datosCliente } = req.body;

    if (!carrito || carrito.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    // 🔒 1. Obtener productos reales desde Google Sheets
    const productosReales = await obtenerProductos();
    
    // 🔒 2. Validar cada ítem: debe existir, precio correcto
    const itemsValidados = [];
    for (const item of carrito) {
      const productoReal = productosReales.find(p => 
        (p.id == item.id) || (p.nombre === item.nombre)
      );
      if (!productoReal) {
        return res.status(400).json({ error: `Producto no encontrado: ${item.nombre}` });
      }
      const precioReal = productoReal.precio * (1 - (productoReal.descuento || 0)/100);
      // Permitir una pequeña diferencia por redondeo
      if (Math.abs(item.precio - precioReal) > 0.01) {
        console.warn(`⚠️ Precio manipulado para ${item.nombre}: esperado ${precioReal}, recibido ${item.precio}`);
        return res.status(400).json({ error: "Precio inválido en el carrito" });
      }
      itemsValidados.push({
        title: item.nombre,
        quantity: Number(item.cantidad),
        unit_price: precioReal,
        currency_id: "COP"
      });
    }

    // 🔒 3. Crear preferencia con precios validados
    const preference = {
      items: itemsValidados,
      payer: {
        name: datosCliente?.nombreCompleto || "Cliente",
        email: datosCliente?.email || "test@test.com"
      },
      back_urls: {
        success: "https://still-bar-8cb0.kyotosc-co.workers.dev/gracias.html",
        failure: "https://still-bar-8cb0.kyotosc-co.workers.dev/error.html",
        pending: "https://still-bar-8cb0.kyotosc-co.workers.dev/pendiente.html"
      },
      auto_return: "approved",
      // 🔒 4. Incluir datos del pedido para referencia
      external_reference: `pedido_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`
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
      return res.status(500).json({ error: data.message || "Error al crear preferencia" });
    }

    // 🔒 5. Opcional: guardar el pedido en una base de datos (ej. Google Sheets)
    // Aquí podrías hacer un POST a tu script de Google Apps Script para guardar el pedido pendiente
    // con el external_reference.

    res.json({ init_point: data.init_point });

  } catch (error) {
    console.error("❌ Error en servidor:", error);
    res.status(500).json({ error: "Error creando preferencia" });
  }
});

// 🔒 6. Webhook para recibir notificaciones de pago
app.post("/webhook", async (req, res) => {
  try {
    const { type, data } = req.body;
    if (type === "payment") {
      const paymentId = data.id;
      // Obtener detalles del pago desde Mercado Pago
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const payment = await response.json();
      if (payment.status === "approved") {
        const externalRef = payment.external_reference;
        // Actualizar estado del pedido en tu sistema (ej. Google Sheets)
        console.log(`✅ Pago aprobado: ${externalRef}`);
        // Aquí puedes guardar el pedido como confirmado
      }
    }
    res.sendStatus(200);
  } catch (error) {
    console.error("❌ Webhook error:", error);
    res.sendStatus(500);
  }
});

app.get("/", (req, res) => res.send("Backend Kyoto con Mercado Pago 🚀"));

app.listen(PORT, "0.0.0.0", () => console.log(`Servidor en puerto ${PORT}`));

import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();

// 🔒 Restringir CORS a tus dominios (ajusta según tu frontend)
const allowedOrigins = [
  'https://still-bar-8cb0.kyotosc-co.workers.dev',
  'https://kyotosc.co',
  'http://localhost:5500',
  'http://localhost:3000'
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

// URLs de Google Sheets
const PRODUCTOS_URL = "https://script.google.com/macros/s/AKfycbzOx-uAUH3p3lM4i5VcISIYNOl_9D_gzhmv25-lf-Vq6V8NCOaJDE0i-yg7_3aYN0rW/exec";
const SHEETS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbwFlDMRWV1kJaVNcu4ouInzRPBf-vY52-Ks-91kSl4m9o7THSo-1DwAiwimsl8er_sQrQ/exec";

// --- Cache de productos (5 minutos) para proteger el servidor ---
let productosCache = null;
let cacheTimestamp = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutos. NO LO PONGAS EN 0 DURANTE EL DROP.

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

// --- Almacenamiento temporal de pedidos (en memoria) ---
const pedidosPendientes = {};

// --- Endpoint para obtener productos (público) ---
app.get("/productos", async (req, res) => {
  try {
    const productos = await obtenerProductos();
    res.json(productos);
  } catch (error) {
    console.error("Error productos:", error);
    res.status(500).json({ error: "Error obteniendo productos" });
  }
});

// --- Endpoint para crear preferencia (seguro) ---
app.post("/crear-preferencia", async (req, res) => {
  try {
    const { carrito, datosCliente } = req.body;

    if (!carrito || carrito.length === 0) {
      return res.status(400).json({ error: "Carrito vacío" });
    }

    // 1. Obtener productos reales desde Google Sheets
    const productosReales = await obtenerProductos();

    // 2. Validar productos y usar precios reales, además incluir talla en título
    const itemsValidados = [];
    for (const item of carrito) {
      // ✅ CORRECCIÓN: Búsqueda exacta por ID como texto para evitar errores
      const productoReal = productosReales.find(p => String(p.id) === String(item.id));
      
      if (!productoReal) {
        return res.status(400).json({ error: `Producto no encontrado: ${item.nombre}` });
      }
      const precioReal = productoReal.precio * (1 - (productoReal.descuento || 0)/100);
      itemsValidados.push({
        title: `${item.nombre} - Talla ${item.talla}`, // 👈 AÑADIMOS LA TALLA AL TÍTULO
        quantity: Number(item.cantidad),
        unit_price: precioReal,
        currency_id: "COP"
      });
    }

    const totalValidado = itemsValidados.reduce((sum, item) => sum + (item.unit_price * item.quantity), 0);
    const externalRef = `pedido_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;

    // Guardar pedido en memoria temporal
    pedidosPendientes[externalRef] = {
      carrito: carrito.map((item, idx) => ({
        ...item,
        precio: itemsValidados[idx].unit_price
      })),
      cliente: datosCliente,
      total: totalValidado
    };

    // 3. Crear preferencia con precios reales y títulos diferenciados
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
      external_reference: externalRef
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
      delete pedidosPendientes[externalRef];
      return res.status(500).json({ error: data.message || "Error al crear preferencia" });
    }

    if (!data.init_point) {
      console.error("❌ No init_point:", data);
      delete pedidosPendientes[externalRef];
      return res.status(500).json({ error: "No se pudo crear el pago" });
    }

    res.json({ init_point: data.init_point });

  } catch (error) {
    console.error("❌ Error en servidor:", error);
    res.status(500).json({ error: "Error creando preferencia" });
  }
});

// --- Webhook para recibir notificaciones de pago ---
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const { type, data } = req.body;
    console.log("📥 Webhook recibido:", { type, data });

    if (type === "payment") {
      const paymentId = data.id;
      const response = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
        headers: { "Authorization": `Bearer ${MP_ACCESS_TOKEN}` }
      });
      const payment = await response.json();

      if (payment.status === "approved") {
        const externalRef = payment.external_reference;
        const pedido = pedidosPendientes[externalRef];

        if (pedido) {
          console.log(`✅ Pago aprobado para ${externalRef}`);

          fetch(SHEETS_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              external_reference: externalRef,
              cliente: pedido.cliente,
              carrito: pedido.carrito,
              total: pedido.total
            })
          }).then(() => {
            console.log(`📊 Pedido ${externalRef} guardado en Google Sheets`);
          }).catch(err => {
            console.error(`❌ Error guardando en Sheets: ${err.message}`);
          });

          delete pedidosPendientes[externalRef];
        } else {
          console.warn(`⚠️ No se encontró pedido pendiente para ${externalRef}`);
        }
      } else {
        console.log(`⏳ Pago no aprobado: ${payment.status} - ${externalRef}`);
      }
    }
  } catch (error) {
    console.error("❌ Error procesando webhook:", error);
  }
});

app.get("/", (req, res) => res.send("Backend Kyoto con Mercado Pago 🚀"));

app.listen(PORT, "0.0.0.0", () => console.log(`Servidor en puerto ${PORT}`));

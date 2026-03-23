import express from "express";
import fetch from "node-fetch";
import cors from "cors";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const BOLD_API_KEY = process.env.BOLD_API_KEY;

// Ruta de prueba
app.get("/", (req, res) => {
  res.send("Backend Kyoto funcionando 🚀");
});

// PRODUCTOS
const productos = [
  {
    id: 1,
    nombre: "Camiseta Kyoto Negra",
    precio: 80000,
    categoria: "Camisetas",
    coleccion: "Drop 01",
    tallas: ["S", "M", "L", "XL"],
    imagen: "https://via.placeholder.com/300x400"
  },
  {
    id: 2,
    nombre: "Camiseta Kyoto Blanca",
    precio: 80000,
    categoria: "Camisetas",
    coleccion: "Drop 01",
    tallas: ["S", "M", "L"],
    imagen: "https://via.placeholder.com/300x400"
  }
];

// ESTA RUTA SOLUCIONA TU ERROR
app.get("/productos", (req, res) => {
  res.json(productos);
});

// CREAR PAGO
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
    console.error(error);
    res.status(500).json({ error: "Error creando pago" });
  }
});

app.listen(PORT, () => {
  console.log("Servidor corriendo en puerto " + PORT);
});

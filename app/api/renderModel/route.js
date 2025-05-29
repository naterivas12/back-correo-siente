/** @format */

import { NextResponse } from "next/server";
import puppeteer from "puppeteer";

// CORS headers
const headers = {
	"Access-Control-Allow-Origin": "*",
	"Content-Type": "application/json",
};

// Handle OPTIONS requests (CORS preflight)
export async function OPTIONS() {
	return new NextResponse(null, { status: 204, headers });
}

export const config = {
	api: {
		bodyParser: {
			sizeLimit: "10mb",
		},
	},
};

export async function POST(req) {
	let browser = null;

	try {
		// Configurar los límites de tamaño para la solicitud
		const contentLength = req.headers.get("content-length");
		if (contentLength && parseInt(contentLength) > 50 * 1024 * 1024) {
			// 50MB limit
			return NextResponse.json(
				{ error: "Payload too large" },
				{ status: 413, headers }
			);
		}

		// Leer el cuerpo de la solicitud en chunks
		let chunks = [];
		const reader = req.body.getReader();
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			chunks.push(value);
		}

		// Combinar los chunks y parsear el JSON
		const text = new TextDecoder().decode(Buffer.concat(chunks));
		let body;
		try {
			body = JSON.parse(text);
		} catch (e) {
			console.error("Error parsing request body:", e);
			return NextResponse.json(
				{ error: "Invalid JSON in request body" },
				{ status: 400, headers }
			);
		}

		const { url, selectedProduct, statusData } = body;

		// Validar la URL del modelo
		if (!url || !url.startsWith("http")) {
			console.error("URL inválida:", url);
			return NextResponse.json(
				{
					error: "Invalid model URL",
					detail: "URL must be a valid HTTP/HTTPS URL",
				},
				{ status: 400, headers }
			);
		}

		// console.log("Received data:", {
		// 	url,
		// 	selectedProduct,
		// 	statusDataLength: statusData?.length,
		// 	metricsKeys: selectedProduct?.metrics
		// 		? Object.keys(selectedProduct.metrics)
		// 		: [],
		// });

		if (
			!url ||
			!selectedProduct ||
			!statusData ||
			!Array.isArray(statusData) ||
			!selectedProduct.metrics
		) {
			return NextResponse.json(
				{ error: "Missing required parameters" },
				{ status: 400, headers }
			);
		}

		browser = await puppeteer.launch({
			headless: "new",
			args: ["--no-sandbox", "--disable-setuid-sandbox"],
		});

		const page = await browser.newPage();
		page.on("console", (msg) => console.log("PAGE LOG:", msg.text()));
		await page.setViewport({ width: 1280, height: 720 });

		// Usar los datos del statusData que vienen en el body
		console.log("Using status data from request body");

		// Preparar y validar los datos antes de pasarlos a page.evaluate
		// Crear copias profundas para evitar modificar objetos constantes
		const safeStatusData = Array.isArray(statusData) 
			? JSON.parse(JSON.stringify(statusData)) 
			: [];
		
		// Validar y preparar selectedProduct y sus métricas
		let safeSelectedProduct = {};
		let safeMetrics = [];
		
		if (selectedProduct && typeof selectedProduct === "object") {
			safeSelectedProduct = JSON.parse(JSON.stringify(selectedProduct));
			
			// Asegurar que metrics sea un array y que cada elemento tenga las propiedades necesarias
			if (Array.isArray(selectedProduct.metrics)) {
				safeMetrics = selectedProduct.metrics.map(metric => {
					// Crear una copia segura de cada métrica
					const safeMetric = { ...metric };
					
					// Asegurar que las propiedades críticas existan
					if (safeMetric.name === undefined) safeMetric.name = "";
					if (safeMetric.delay === undefined) safeMetric.delay = 0;
					
					return safeMetric;
				});
			}
		}
		
		// Crear el objeto de configuración final con datos seguros
		const viewerConfig = {
			statusData: safeStatusData,
			selectedProduct: {
				...safeSelectedProduct,
				metrics: safeMetrics // Asegurar que metrics sea un array válido
			},
			modelUrl: url  // Incluir la URL del modelo para acceso directo
		};

		console.log("ViewerConfig prepared with", {
			statusDataLength: viewerConfig.statusData.length,
			metricsLength: viewerConfig.selectedProduct.metrics.length,
			hasModelUrl: !!viewerConfig.modelUrl
		});
		
		// Verificar si hay métricas para depuración
		if (viewerConfig.selectedProduct.metrics.length > 0) {
			const sampleMetric = viewerConfig.selectedProduct.metrics[0];
			console.log("Ejemplo de métrica preparada:", JSON.stringify(sampleMetric));
		}

		// Cargar el viewer y renderizar el modelo
		console.log("Loading viewer page...");
		await page.goto("https://back-correo-siente.vercel.app/viewer.html");
		// await page.goto("http://localhost:3500/viewer.html");

		console.log("Evaluating model in viewer...");
		try {
			// Esperar a que el canvas esté disponible
			await page.waitForSelector("#myCanvas");

			// Esperar a que el viewer esté inicializado
			await page.waitForFunction(() => window.viewer !== null, {
				timeout: 5000,
			});

			// Cargar el modelo
			await page.evaluate(async (modelUrl) => {
				console.log("Intentando cargar modelo desde:", modelUrl);
				if (!window.viewer) {
					throw new Error("Viewer no está inicializado");
				}
				if (typeof window.loadModelAndCapture !== "function") {
					throw new Error("loadModelAndCapture no está definido");
				}
				await window.loadModelAndCapture(modelUrl);
			}, url);
		} catch (error) {
			console.error("Error al cargar el modelo:", error);
			throw error;
		}

		// Esperar 1 segundo para asegurar que el modelo esté cargado
		console.log("Waiting for model to load completely...");
		await new Promise((resolve) => setTimeout(resolve, 2000));

		// Una vez que el modelo está cargado, aplicar los colores
		await page.evaluate((config) => {
			// Verificar que config exista y tenga las propiedades necesarias
			if (!config || !config.statusData || !config.selectedProduct || !Array.isArray(config.selectedProduct.metrics)) {
				console.error("Configuración incompleta o inválida");
				return;
			}
			
			try {
				// Funciones auxiliares para colores
				const getStatusColor = (status) => {
					switch (status) {
						case "Curing":
							return [1, 1, 0]; // Amarillo
						case "Detailing Approved":
							return [1, 0.455, 1]; // Rosa
						case "Elements in Workshop":
							return [1, 0.4, 0]; // Naranja
						case "Transit":
							return [0.004, 0.686, 0.933]; // Azul claro
						case "Elements Onsite":
							return [0, 0.439, 0.753]; // Azul oscuro
						case "Precast Reception":
							return [0.004, 0.439, 0.749]; // Azul oscuro
						case "Early":
							return [0.012, 0.686, 0.318]; // Verde
						case "On Time":
							return [0.5, 0.5, 0.5]; // Gris
						case "Late":
							return [0.988, 0.016, 0.008]; // Rojo
						case "Precast Approved":
							return [1, 0.753, 0.012]; // Amarillo dorado
						case "#03af51":
							return [0.988, 0.016, 0.008]; // Rojo
						case "#aaaaaa":
							return [0.012, 0.686, 0.318]; // Verde
						default:
							return [1, 1, 1]; // Blanco
					}
				};

				const getStatusColorMetrica = (atencion) => {
					switch (atencion) {
						case "No Atendió":
							return [0.988, 0.016, 0.008]; // Rojo
						case "Atención Total":
							return [0.012, 0.686, 0.318]; // Verde
						default:
							return [0.012, 0.686, 0.318];
					}
				};

				const hexToRgb = (hex) => {
					const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
					return result
						? [
								parseInt(result[1], 16) / 255,
								parseInt(result[2], 16) / 255,
								parseInt(result[3], 16) / 255,
						  ]
						: [0.5, 0.5, 0.5];
				};

				// Inicializar el viewer y verificar que esté correctamente cargado
				const viewer = window.viewer;
				if (!viewer || !viewer.scene || !viewer.scene.objects) {
					console.error("Viewer no inicializado correctamente");
					return;
				}
				
				// Extraer datos del config
				const { statusData, selectedProduct } = config;
				const objects = viewer.scene.objects;
				
				// Encontrar niveles únicos
				const uniqueNiveles = [
					...new Set(statusData.map((item) => item.TSC_NIVEL)),
				];
				uniqueNiveles.sort((a, b) => {
					const numA = parseInt(a.split(" ")[1]) || 0;
					const numB = parseInt(b.split(" ")[1]) || 0;
					return numB - numA;
				});
				const highestLevel = uniqueNiveles[0] || "";

				// Procesar cada objeto
				for (const objectId in objects) {
					const object = objects[objectId];
					
					// Buscar el objeto en statusData por su ID
					const statusItem = statusData.find((item) => item.ID === objectId);
					if (!statusItem) {
						object.colorize = [0, 0, 0];
						object.opacity = 0;
						object.visible = false;
						continue;
					}

					// Manejar SECTORIZACION y NIVELES
					if (statusItem.TSC_PRODUCTO === "SECTORIZACION") {
						if (statusItem.TSC_NIVEL === highestLevel) {
							object.colorize = [0, 0, 0];
							object.opacity = 0.8;
							object.visible = true;
						} else {
							object.colorize = [0, 0, 0];
							object.opacity = 0;
							object.visible = false;
						}
						continue;
					}

					if (statusItem.TSC_PRODUCTO === "NIVELES") {
						if (uniqueNiveles.includes(statusItem.TSC_NIVEL)) {
							object.colorize = [0, 0, 0];
							object.opacity = 0.8;
							object.visible = true;
						} else {
							object.colorize = [0, 0, 0];
							object.opacity = 0;
							object.visible = false;
						}
						continue;
					}

					// Obtener el nombre de la métrica según las reglas especificadas
					let metricName = "--";

					// Determinar el tipo de producto para saber qué campo usar
					if (statusItem.TSC_PRODUCTO === "ACEDIM") {
						// Para ACEDIM usar TSC_ACEDIM
						metricName = statusItem.TSC_ACEDIM;
					} else if (statusItem.TSC_PRODUCTO === "CONCRETO") {
						// Para CONCRETO usar TSC_CONCRETO
						metricName = statusItem.TSC_CONCRETO;
					} else {
						// En otros casos usar PLANO
						metricName = statusItem.PLANO;
					}

					// Buscar una métrica cuyo nombre coincida con metricName
					// IMPORTANTE: Verificar que metricName sea válido antes de usarlo
					if (!metricName) {
						metricName = "";
					}
					
					// Buscar la métrica que coincida con el nombre
					const matchingMetric = selectedProduct.metrics.find(
						(m) => m && m.name && (
							m.name === metricName ||
							// Intentar coincidencia parcial si es necesario
							(metricName && typeof metricName.includes === 'function' && metricName.includes(m.name)) ||
							(m.name && typeof m.name.includes === 'function' && m.name.includes(metricName))
						)
					);

					// Verificar si matchingMetric existe antes de acceder a sus propiedades
					if (matchingMetric) {
						console.log(
							`Encontrada coincidencia parcial para ${metricName}: ${matchingMetric.name}--- ${matchingMetric.delay}`
						);
					}

					// Si no hay métrica pero está en un nivel válido, mostrar en gris
					if (!matchingMetric) {
						if (uniqueNiveles.includes(statusItem.TSC_NIVEL)) {
							object.colorize = [0, 0, 0];
							object.opacity = 0.2;
							object.visible = true;
						} else {
							object.colorize = [0, 0, 0];
							object.opacity = 0;
							object.visible = false;
						}
						continue;
					}

					// Definir delay de forma segura, verificando que matchingMetric exista
					const delay = matchingMetric && matchingMetric.delay !== undefined ? matchingMetric.delay : 0;

					// Aplicar colores basados en el estado
					let statusColor = [0.667, 0.667, 0.667]; // Color por defecto
					let opacity = 1.0;

					// Evaluar el delay y aplicar colores correspondientes
					if (delay !== undefined && delay !== null) {
						try {
							// Convertir delay a número si es string
							const delayNum = Number(delay);
							console.log(`Delay para ${objectId} (${metricName}): ${delayNum}`);

							// Determinar el estado y color basado en delay
							let estado, delayColor;
							if (delayNum < 0) {
								estado = "Temprano (Early)";
								delayColor = getStatusColor("Early");
							} else if (delayNum === 0) {
								estado = "A tiempo (On Time)";
								delayColor = getStatusColor("On Time");
							} else {
								estado = "Tarde (Late)";
								delayColor = getStatusColor("Late");
							}

							console.log(`Estado basado en delay para ${objectId}: ${estado}`);

							// Aplicar el color al objeto
							object.colorize = delayColor;
							object.opacity = opacity;
							object.visible = true;
						} catch (error) {
							console.error(`Error al procesar delay para ${objectId}:`, error);
							// En caso de error, aplicar color por defecto
							object.colorize = [0.5, 0.5, 0.5]; // Color gris por defecto
							object.opacity = opacity;
							object.visible = true;
						}
					}

					// Si no se aplicó color por delay, verificar otras propiedades o aplicar color por defecto
					if (matchingMetric && (delay === undefined || delay === null)) {
						try {
							let colorAplicado = false;

							// Verificar si hay otras propiedades para determinar el color
							if (matchingMetric.Atencion) {
								// Aplicar color basado en Atención
								object.colorize = getStatusColorMetrica(matchingMetric.Atencion);
								colorAplicado = true;
								console.log(
									`Color aplicado por Atencion para ${objectId}: ${matchingMetric.Atencion}`
								);
							} else if (matchingMetric.EstadoPlanner) {
								// Aplicar color basado en EstadoPlanner
								object.colorize = getStatusColor(matchingMetric.EstadoPlanner);
								colorAplicado = true;
								console.log(
									`Color aplicado por EstadoPlanner para ${objectId}: ${matchingMetric.EstadoPlanner}`
								);
							} else if (matchingMetric.ColorEstadoReal) {
								// Aplicar color basado en ColorEstadoReal
								object.colorize = hexToRgb(matchingMetric.ColorEstadoReal);
								colorAplicado = true;
								console.log(
									`Color aplicado por ColorEstadoReal para ${objectId}: ${matchingMetric.ColorEstadoReal}`
								);
							}

							// Si no se aplicó ningún color específico, usar gris por defecto
							if (!colorAplicado) {
								object.colorize = [0.5, 0.5, 0.5]; // Color gris por defecto
								console.log(`Color gris por defecto aplicado para ${objectId}`);
							}

							// Establecer opacidad y visibilidad
							object.opacity = opacity;
							object.visible = true;
						} catch (error) {
							console.error(
								`Error al aplicar colores alternativos para ${objectId}:`,
								error
							);
							// En caso de error, aplicar color por defecto
							object.colorize = [0.5, 0.5, 0.5]; // Color gris por defecto
							object.opacity = opacity;
							object.visible = true;
						}
					}
				}
			} catch (error) {
				console.error("Error al procesar el modelo:", error);
			}
		}, viewerConfig);

		// Wait until modelIsReady is set
		console.log("Waiting for model to be ready...");
		await page.waitForFunction(() => window.modelIsReady === true);

		// Esperar 2 segundos adicionales para asegurar que todo esté renderizado
		console.log("Waiting additional time for rendering...");
		await new Promise((resolve) => setTimeout(resolve, 2000));

		console.log("Taking screenshot...");
		const buffer = await page.screenshot({ encoding: "base64" });
		const base64 = `data:image/png;base64,${buffer}`;

		return NextResponse.json({ image: base64 }, { headers });
	} catch (error) {
		console.error("Error in renderModel:", error);
		return NextResponse.json(
			{ error: "Failed to render image", detail: error.message },
			{ status: 500, headers }
		);
	} finally {
		if (browser) {
			console.log("Closing browser...");
			await browser.close();
		}
	}
}

// Funciones de colores
function getStatusColor(status) {
	switch (status) {
		case "Curing":
			return [1, 1, 0]; // Amarillo
		case "Detailing Approved":
			return [1, 0.455, 1]; // Rosa
		case "Elements in Workshop":
			return [1, 0.4, 0]; // Naranja
		case "Transit":
			return [0.004, 0.686, 0.933]; // Azul claro
		case "Elements Onsite":
			return [0, 0.439, 0.753]; // Azul oscuro
		case "Precast Reception":
			return [0.004, 0.439, 0.749]; // Azul oscuro
		case "Early":
			return [0.012, 0.686, 0.318]; // Verde
		case "On Time":
			return [0.5, 0.5, 0.5]; // Gris
		case "Late":
			return [0.988, 0.016, 0.008]; // Rojo
		case "Precast Approved":
			return [1, 0.753, 0.012]; // Amarillo dorado
		case "#03af51":
			return [0.988, 0.016, 0.008]; // Rojo
		case "#aaaaaa":
			return [0.012, 0.686, 0.318]; // Verde
		default:
			return [1, 1, 1]; // Blanco
	}
}

function getStatusColorMetrica(atencion) {
	switch (atencion) {
		case "No Atendió":
			return [0.988, 0.016, 0.008]; // Rojo
		case "Atención Total":
			return [0.012, 0.686, 0.318]; // Verde
		default:
			return [0.012, 0.686, 0.318];
	}
}

function hexToRgb(hex) {
	const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
	return result
		? [
				parseInt(result[1], 16) / 255,
				parseInt(result[2], 16) / 255,
				parseInt(result[3], 16) / 255,
		  ]
		: [0.5, 0.5, 0.5];
}

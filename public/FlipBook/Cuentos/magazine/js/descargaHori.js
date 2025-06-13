const { PDFDocument } = PDFLib;

async function embedImages(cuento, totalPages) {
  try {
    // Crear un nuevo documento PDF
    const pdfDoc = await PDFDocument.create();
    const images = [];
    let successfulLoads = 0;

    // Cargar todas las imágenes
    for (let i = 1; i <= totalPages; i++) {
      try {
        const imageUrl = `cuentos/${cuento}/${i}.jpg`; // Ruta dinámica
        console.log(`Cargando imagen: ${imageUrl}`); // Para depuración
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`No se pudo cargar la imagen ${imageUrl}: ${response.status}`);
        }
        const imageBytes = await response.arrayBuffer();
        const image = await pdfDoc.embedJpg(imageBytes); // Asumiendo que son JPG
        images.push(image);
        successfulLoads++;
      } catch (error) {
        console.error(`Error al cargar la imagen para la página ${i}:`, error);
        images.push(null); // Placeholder para mantener el orden
      }
    }

    console.log(`Imágenes cargadas exitosamente: ${successfulLoads} de ${totalPages}`);

    // Si no se cargó ninguna imagen, no generar el PDF
    if (successfulLoads === 0) {
      throw new Error("No se pudo cargar ninguna imagen. No se generará el PDF.");
    }

    // Página 1: Portada (imagen 1, centrada en página horizontal)
    if (images[0]) {
      const page = pdfDoc.addPage([842, 595]); // A4 horizontal (ancho: 842, alto: 595)
      const portadaImage = images[0];
      const portadaDims = portadaImage.scaleToFit(792, 545); // Margen de 25 puntos
      page.drawImage(portadaImage, {
        x: (page.getWidth() - portadaDims.width) / 2,
        y: (page.getHeight() - portadaDims.height) / 2,
        width: portadaDims.width,
        height: portadaDims.height,
        rotate: PDFLib.degrees(0),
      });
    } else {
      console.warn("No se pudo cargar la portada (imagen 1).");
    }

    // Páginas de capítulos: Imágenes 2-3, 4-5, ..., etc. (texto izquierda, cuento derecha)
    for (let i = 1; i < images.length - 1; i += 2) {
      const page = pdfDoc.addPage([842, 595]); // A4 horizontal

      // Imagen izquierda (texto, ej. 2, 4, 6, ...)
      if (images[i]) {
        const leftImage = images[i];
        const leftDims = leftImage.scaleToFit(396, 545); // Mitad del ancho, margen vertical
        page.drawImage(leftImage, {
          x: 25, // Margen izquierdo
          y: (page.getHeight() - leftDims.height) / 2, // Centrar verticalmente
          width: leftDims.width,
          height: leftDims.height,
          rotate: PDFLib.degrees(0),
        });
      } else {
        console.warn(`No se pudo cargar la imagen izquierda ${i}.`);
      }

      // Imagen derecha (cuento, ej. 3, 5, 7, ...)
      if (i + 1 < images.length - 1 && images[i + 1]) {
        const rightImage = images[i + 1];
        const rightDims = rightImage.scaleToFit(396, 545); // Mitad del ancho, margen vertical
        page.drawImage(rightImage, {
          x: page.getWidth() - rightDims.width - 25, // Margen derecho
          y: (page.getHeight() - rightDims.height) / 2, // Centrar verticalmente
          width: rightDims.width,
          height: rightDims.height,
          rotate: PDFLib.degrees(0),
        });
      } else {
        console.warn(`No se pudo cargar la imagen derecha ${i + 1}.`);
      }
    }

    // Última página: Contraportada (imagen final, centrada en página horizontal)
    if (images[images.length - 1]) {
      const page = pdfDoc.addPage([842, 595]); // A4 horizontal
      const contraportadaImage = images[images.length - 1];
      const contraportadaDims = contraportadaImage.scaleToFit(792, 545); // Margen de 25 puntos
      page.drawImage(contraportadaImage, {
        x: (page.getWidth() - contraportadaDims.width) / 2,
        y: (page.getHeight() - contraportadaDims.height) / 2,
        width: contraportadaDims.width,
        height: contraportadaDims.height,
        rotate: PDFLib.degrees(0),
      });
    } else {
      console.warn("No se pudo cargar la contraportada (última imagen).");
    }

    // Serializar y descargar el PDF
    const pdfBytes = await pdfDoc.save();
    download(pdfBytes, `${cuento}.pdf`, "application/pdf");
  } catch (error) {
    console.error("Error al generar el PDF:", error);
    alert("No se pudo generar el PDF. Verifica la consola para más detalles.");
  }
}
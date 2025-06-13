const { PDFDocument } = PDFLib;

async function embedImages(cuento, totalPages) {
  try {
    // Crear un nuevo documento PDF
    const pdfDoc = await PDFDocument.create();
    const images = [];

    // Cargar todas las imágenes
    for (let i = 1; i <= totalPages; i++) {
      try {
        const imageUrl = `cuentos/${cuento}/${i}.jpg`; // Ruta dinámica
        const response = await fetch(imageUrl);
        if (!response.ok) {
          throw new Error(`No se pudo cargar la imagen ${imageUrl}`);
        }
        const imageBytes = await response.arrayBuffer();
        const image = await pdfDoc.embedJpg(imageBytes); // Asumiendo que son JPG
        images.push(image);
      } catch (error) {
        console.error(`Error al cargar la imagen para la página ${i}:`, error);
        images.push(null); // Placeholder para mantener el orden
      }
    }

    // Estructurar las páginas del PDF
    // Página 1: Portada (imagen 1)
    if (images[0]) {
      const page = pdfDoc.addPage([595, 842]); // A4 en puntos
      const portadaImage = images[0];
      const portadaDims = portadaImage.scaleToFit(550, 792); // Margen de 20 puntos
      page.drawImage(portadaImage, {
        x: (page.getWidth() - portadaDims.width) / 2,
        y: (page.getHeight() - portadaDims.height) / 2,
        width: portadaDims.width,
        height: portadaDims.height,
      });
    }

    // Páginas de capítulos: Imágenes 2-3, 4-5, ..., etc. (pares)
    for (let i = 1; i < images.length - 1; i += 2) {
      const page = pdfDoc.addPage([595, 842]);

      // Imagen superior (ej. 2, 4, 6, ...)
      if (images[i]) {
        const topImage = images[i];
        const topDims = topImage.scaleToFit(550, 396); // Mitad de la página con margen
        page.drawImage(topImage, {
          x: (page.getWidth() - topDims.width) / 2,
          y: page.getHeight() - topDims.height - 20, // Margen superior
          width: topDims.width,
          height: topDims.height,
        });
      }

      // Imagen inferior (ej. 3, 5, 7, ...)
      if (i + 1 < images.length - 1 && images[i + 1]) {
        const bottomImage = images[i + 1];
        const bottomDims = bottomImage.scaleToFit(550, 396);
        page.drawImage(bottomImage, {
          x: (page.getWidth() - bottomDims.width) / 2,
          y: 20, // Margen inferior
          width: bottomDims.width,
          height: bottomDims.height,
        });
      }
    }

    // Última página: Contraportada (última imagen)
    if (images[images.length - 1]) {
      const page = pdfDoc.addPage([595, 842]);
      const contraportadaImage = images[images.length - 1];
      const contraportadaDims = contraportadaImage.scaleToFit(550, 792);
      page.drawImage(contraportadaImage, {
        x: (page.getWidth() - contraportadaDims.width) / 2,
        y: (page.getHeight() - contraportadaDims.height) / 2,
        width: contraportadaDims.width,
        height: contraportadaDims.height,
      });
    }

    // Serializar y descargar el PDF
    const pdfBytes = await pdfDoc.save();
    download(pdfBytes, `${cuento}.pdf`, "application/pdf");
  } catch (error) {
    console.error("Error al generar el PDF:", error);
    alert("No se pudo generar el PDF. Verifica la consola para más detalles.");
  }
}
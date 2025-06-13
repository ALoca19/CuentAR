const express = require('express');
const multer = require('multer');
const path = require('path');
const sharp = require('sharp');
const fs = require('fs');
const fsPromises = require('fs').promises;
const { createCanvas } = require('canvas');
const sqlite3 = require('sqlite3').verbose();
const os = require('os');

const app = express();
const port = 3000;

const db = new sqlite3.Database('cuentos.db', (err) => {
    if (err) {
        console.error('Error al conectar a la base de datos:', err);
    } else {
        console.log('Conectado a la base de datos SQLite');
    }
});

db.run(`
    CREATE TABLE IF NOT EXISTS cuentos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        titulo TEXT NOT NULL,
        autor TEXT NOT NULL,
        categoria TEXT NOT NULL,
        ruta TEXT NOT NULL,
        paginas INTEGER NOT NULL
    )
`);

const baseFlipbookDir = path.join(__dirname, 'public', 'FlipBook', 'Cuentos', 'magazine', 'cuentos');

if (!fs.existsSync(baseFlipbookDir)) {
    fs.mkdirSync(baseFlipbookDir, { recursive: true });
}

const getCuentoDir = (id) => {
    const dir = path.join(baseFlipbookDir, `cuento_${id}`);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
};

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const tempDir = path.join(__dirname, 'temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }
        cb(null, tempDir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname);
        let index;
        if (file.fieldname === 'portada') {
            index = 1;
        } else if (file.fieldname.startsWith('imagen_')) {
            const chapterNum = parseInt(file.fieldname.split('_')[1]);
            index = chapterNum * 2 + 1;
        } else if (file.fieldname.startsWith('glb_')) {
            const chapterNum = parseInt(file.fieldname.split('_')[1]);
            index = chapterNum * 2 + 1;
        }
        cb(null, `${index}${ext}`);
    }
});

const upload = multer({ storage: storage });

app.use(express.static('public'));

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    if (!text || text.trim() === '') {
        console.warn('Texto vacío, no se renderizará nada en el canvas');
        return y;
    }

    const paragraphs = text.split('\n');
    let currentY = y; // Usar el valor de y pasado como parámetro

    paragraphs.forEach(paragraph => {
        const words = paragraph.trim().split(' ');
        let line = '';
        let lines = [];

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = context.measureText(testLine);
            const testWidth = metrics.width;

            if (testWidth > maxWidth && n > 0) {
                lines.push(line.trim());
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line.trim());

        lines.forEach((lineText, i) => {
            if (currentY + (i * lineHeight) <= context.canvas.height - 20) {
                context.fillText(lineText, x, currentY + (i * lineHeight));
            }
        });

        currentY += lines.length * lineHeight;
    });

    return currentY;
}

app.post('/guardar-cuento', upload.any(), async (req, res) => {
    try {
        const titulo = req.body.tituloCuento;
        const autor = req.body.autor;
        const categoria = req.body.categoria;

        // Validar la categoría
        const categoriasValidas = ['saberes', 'lenguaje', 'humanidades', 'etica'];
        if (!categoriasValidas.includes(categoria)) {
            throw new Error('Categoría inválida');
        }

        // Verificar que la portada esté presente
        if (!req.files.some(file => file.fieldname === 'portada')) {
            throw new Error('La portada es obligatoria');
        }

        // Determinar el número de capítulos
        const chapterNumbers = new Set();
        req.files.forEach(file => {
            if (file.fieldname !== 'portada') {
                const num = parseInt(file.fieldname.split('_')[1]);
                chapterNumbers.add(num);
            }
        });
        Object.keys(req.body).forEach(key => {
            if (key.startsWith('texto_')) {
                const num = parseInt(key.split('_')[1]);
                chapterNumbers.add(num);
            }
        });

        const chapters = Array.from(chapterNumbers);

        // Validar la longitud del texto de todos los capítulos ANTES de guardar
        for (const chapterNum of chapters) {
            const hasImagen = req.files.some(file => file.fieldname === `imagen_${chapterNum}`);
            const hasTexto = req.body[`texto_${chapterNum}`] && req.body[`texto_${chapterNum}`].trim() !== '';

            if (!hasImagen || !hasTexto) {
                throw new Error(`El capítulo ${chapterNum} debe tener imagen y texto`);
            }

            const textContent = req.body[`texto_${chapterNum}`];
            console.log(`Validando texto para capítulo ${chapterNum}: "${textContent}"`);
            if (textContent.length > 1000) {
                throw new Error(`El texto del capítulo ${chapterNum} es demasiado largo. Por favor, usa menos de 1000 caracteres.`);
            }
        }

        // Si todas las validaciones pasan, proceder con el guardado
        const numeroPaginas = 2 + 2 * chapters.length; // Portada + 2 páginas por sección (incluye contraportada)

        // Insertar en la base de datos con el número de páginas
        const id = await new Promise((resolve, reject) => {
            db.run(
                'INSERT INTO cuentos (titulo, autor, categoria, ruta, paginas) VALUES (?, ?, ?, ?, ?)',
                [titulo, autor, categoria, '', numeroPaginas],
                function(err) {
                    if (err) reject(err);
                    else resolve(this.lastID);
                }
            );
        });

        const cuentoDir = getCuentoDir(id);

        // Mover archivos del directorio temporal al final y redimensionar la portada
        for (const file of req.files) {
            const newPath = path.join(cuentoDir, file.filename);
            await fsPromises.rename(file.path, newPath);

            // Redimensionar la portada directamente en su ubicación final
            if (file.fieldname === 'portada') {
                try {
                    await sharp(newPath)
                        .resize(566, 624, {
                            fit: 'cover',
                            position: 'center'
                        })
                        .toFile(newPath + '.temp.jpg');
                    await fsPromises.rename(newPath + '.temp.jpg', newPath);
                    console.log(`Portada redimensionada a 566x624 y guardada en: ${newPath}`);
                } catch (error) {
                    console.error(`Error al redimensionar la portada para cuento_${id}:`, error);
                    throw new Error(`No se pudo redimensionar la portada: ${error.message}`);
                }
            }
        }

        // Actualizar la ruta en la base de datos
        await new Promise((resolve, reject) => {
            db.run(
                'UPDATE cuentos SET ruta = ? WHERE id = ?',
                [cuentoDir, id],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                }
            );
        });

        // Generar imágenes para los capítulos
        for (const chapterNum of chapters) {
            // Generar imagen del texto
            const textContent = req.body[`texto_${chapterNum}`];
            const canvas = createCanvas(566, 624);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'black';
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';

            const maxWidth = canvas.width - 40;
            const lineHeight = 25;
            wrapText(ctx, textContent, canvas.width / 2, 20, maxWidth, lineHeight);

            const textImagePath = path.join(cuentoDir, `${chapterNum * 2}.jpg`);
            const out = fs.createWriteStream(textImagePath);
            const stream = canvas.createJPEGStream();
            stream.pipe(out);
            await new Promise(resolve => out.on('finish', () => {
                console.log(`Imagen de texto guardada en: ${textImagePath}`);
                resolve();
            }));
        }

        // Generar la contraportada
        const contraportadaPath = path.join(cuentoDir, `${numeroPaginas}.jpg`);
        await generarContraportada(titulo, autor, contraportadaPath);

        // Enviar respuesta JSON
        res.json({
            success: true,
            id: id,
            paginas: numeroPaginas,
            mensaje: `Cuento guardado en ${cuentoDir} con ID ${id} y ${numeroPaginas} páginas`,
            redirect: '/index.html'
        });

    } catch (error) {
        console.error('Error al guardar el cuento:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
});

app.post('/previsualizar-cuento', upload.any(), async (req, res) => {
    try {
        const titulo = req.body.tituloCuento;
        const autor = req.body.autor;
        const categoria = req.body.categoria;
        const tempDir = path.join(os.tmpdir(), `cuento_temp_${Date.now()}`);
        await fsPromises.mkdir(tempDir, { recursive: true });

        // Validar la categoría
        const categoriasValidas = ['saberes', 'lenguaje', 'humanidades', 'etica'];
        if (!categoriasValidas.includes(categoria)) {
            throw new Error('Categoría inválida');
        }

        if (!req.files.some(file => file.fieldname === 'portada')) {
            throw new Error('La portada es obligatoria');
        }

        // Determinar el número de capítulos
        const chapterNumbers = new Set();
        req.files.forEach(file => {
            if (file.fieldname !== 'portada') {
                const num = parseInt(file.fieldname.split('_')[1]);
                chapterNumbers.add(num);
            }
        });
        Object.keys(req.body).forEach(key => {
            if (key.startsWith('texto_')) {
                const num = parseInt(key.split('_')[1]);
                chapterNumbers.add(num);
            }
        });

        const chapters = Array.from(chapterNumbers);
        const numeroPaginas = chapters.length * 2 + 2; // Fórmula: capítulos * 2 + 2 (portada + contraportada)
        let pageNum = 1; // Comienza en 1 para Turn.js

        // Guardar la portada como 1.jpg y redimensionarla
        const portadaFile = req.files.find(file => file.fieldname === 'portada');
        if (portadaFile) {
            const portadaPath = path.join(tempDir, `${pageNum}.jpg`);
            await fsPromises.rename(portadaFile.path, portadaPath);

            // Redimensionar la portada directamente en su ubicación final
            try {
                await sharp(portadaPath)
                    .resize(566, 624, {
                        fit: 'cover',
                        position: 'center'
                    })
                    .toFile(portadaPath + '.temp.jpg');
                await fsPromises.rename(portadaPath + '.temp.jpg', portadaPath);
                console.log(`Portada de previsualización redimensionada a 566x624 y guardada en: ${portadaPath}`);
            } catch (error) {
                console.error(`Error al redimensionar la portada de previsualización:`, error);
                throw new Error(`No se pudo redimensionar la portada: ${error.message}`);
            }

            pageNum++;
        }

        // Generar imágenes para los capítulos
        for (const chapterNum of chapters) {
            const hasImagen = req.files.some(file => file.fieldname === `imagen_${chapterNum}`);
            const hasTexto = req.body[`texto_${chapterNum}`] && req.body[`texto_${chapterNum}`].trim() !== '';

            if (!hasImagen || !hasTexto) {
                throw new Error(`El capítulo ${chapterNum} debe tener imagen y texto`);
            }

            // Validar la longitud del texto
            const textContent = req.body[`texto_${chapterNum}`];
            console.log(`Texto para capítulo ${chapterNum} (previsualización): "${textContent}"`); // Depuración
            if (textContent.length > 1000) {
                throw new Error(`El texto del capítulo ${chapterNum} es demasiado largo. Por favor, usa menos de 300 caracteres.`);
            }

            // Generar imagen del texto
            const canvas = createCanvas(566, 624);
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = 'white';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = 'black';
            ctx.font = '20px Arial';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top'; // Cambiar a 'top' para empezar desde la parte superior

            const maxWidth = canvas.width - 40;
            const lineHeight = 25;
            wrapText(ctx, textContent, canvas.width / 2, 20, maxWidth, lineHeight); // Ajustar y a 20 para empezar desde arriba

            const textImagePath = path.join(tempDir, `${pageNum}.jpg`);
            const out = fs.createWriteStream(textImagePath);
            const stream = canvas.createJPEGStream();
            stream.pipe(out);
            await new Promise(resolve => out.on('finish', () => {
                console.log(`Imagen de texto (previsualización) guardada en: ${textImagePath}`);
                resolve();
            }));
            pageNum++;

            // Guardar la imagen del capítulo
            const imagenFile = req.files.find(file => file.fieldname === `imagen_${chapterNum}`);
            if (imagenFile) {
                const imagenPath = path.join(tempDir, `${pageNum}.jpg`);
                await fsPromises.rename(imagenFile.path, imagenPath);
                pageNum++;
            }
        }

        // Generar la contraportada
        const contraportadaPath = path.join(tempDir, `${pageNum}.jpg`);
        await generarContraportada(titulo, autor, contraportadaPath);

        app.use(`/temp/${path.basename(tempDir)}`, express.static(tempDir));

        res.json({
            success: true,
            tempDir: `/temp/${path.basename(tempDir)}`,
            contador: numeroPaginas,
            titulo,
            autor,
            chapters: chapters.map(num => ({
                texto: req.body[`texto_${num}`],
                imagen: `${pageNum - 1}.jpg`
            }))
        });

    } catch (error) {
        console.error('Error al previsualizar el cuento:', error);
        res.status(400).json({ success: false, message: error.message });
    }
});

function generarContraportada(titulo, autor, outputPath) {
    const canvas = createCanvas(566, 624);
    const ctx = canvas.getContext('2d');

    // Fondo blanco
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Configuración del texto
    ctx.fillStyle = 'black';
    ctx.font = '20px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // Configuración de dimensiones
    const lineHeight = 30;
    const maxWidth = canvas.width - 40;
    let currentY = canvas.height / 2 - 60;

    // Función para dividir el título en varias líneas
    function wrapTitle(context, text, x, maxWidth) {
        const words = text.split(' ');
        let line = '';
        let lines = [];

        for (let n = 0; n < words.length; n++) {
            const testLine = line + words[n] + ' ';
            const metrics = context.measureText(testLine);
            const testWidth = metrics.width;

            if (testWidth > maxWidth && n > 0) {
                lines.push(line.trim());
                line = words[n] + ' ';
            } else {
                line = testLine;
            }
        }
        lines.push(line.trim());

        lines.forEach((lineText, i) => {
            context.fillText(lineText, x, currentY + (i * lineHeight));
        });

        return lines.length;
    }

    // Dibujar el título
    const titleLines = wrapTitle(ctx, titulo, canvas.width / 2, maxWidth);
    currentY += titleLines * lineHeight;

    // "Creado por [Autor]"
    const autorText = `Creado por ${autor.length > 30 ? autor.substring(0, 27) + '...' : autor}`;
    ctx.fillText(autorText, canvas.width / 2, currentY);
    currentY += lineHeight;

    // "¡Gracias por leer!"
    ctx.fillText('¡Gracias por leer!', canvas.width / 2, currentY);

    // Guardar la imagen
    const out = fs.createWriteStream(outputPath);
    const stream = canvas.createJPEGStream();
    stream.pipe(out);
    return new Promise(resolve => out.on('finish', resolve));
}

app.get('/api/cuentos', async (req, res) => {
    try {
        const cuentos = await new Promise((resolve, reject) => {
            db.all('SELECT * FROM cuentos', [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows);
            });
        });

        const cuentosResponse = cuentos.map(cuento => ({
            id: cuento.id,
            title: cuento.titulo,
            autor: cuento.autor,
            categoria: cuento.categoria,
            paginas: cuento.paginas,
            img: `/FlipBook/Cuentos/magazine/cuentos/cuento_${cuento.id}/1.jpg`,
            link: `/FlipBook/Cuentos/magazine/CuentosGeneral.html?cuento=cuento_${cuento.id}&num=${cuento.paginas}`
        }));

        res.json(cuentosResponse);
    } catch (error) {
        console.error('Error al listar cuentos:', error);
        res.status(500).json({ error: 'Error al leer los cuentos' });
    }
});

process.on('SIGINT', () => {
    db.close((err) => {
        if (err) {
            console.error('Error al cerrar la base de datos:', err);
        }
        process.exit(0);
    });
});

app.listen(port, () => {
    console.log(`Servidor corriendo en http://localhost:${port}`);
});
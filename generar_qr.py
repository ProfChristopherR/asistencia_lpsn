import cv2
from reportlab.lib.pagesizes import landscape, A4
from reportlab.pdfgen import canvas
from reportlab.lib.utils import ImageReader
import io
import os

def generar_aruco_numero_lista_pdf(cantidad=60, nombre_pdf="numeros_de_lista.pdf"):
    """
    Genera un PDF horizontal con 2 codigos ArUco por pagina.
    - Formato: A4 acostado (landscape)
    - Codigo izquierdo + Codigo derecho
    - Debajo de cada codigo: "N de Lista: X"
    """
    ruta_pdf = os.path.join(os.path.dirname(__file__), nombre_pdf)
    c = canvas.Canvas(ruta_pdf, pagesize=landscape(A4))
    ancho, alto = landscape(A4)

    dictionary = cv2.aruco.getPredefinedDictionary(cv2.aruco.DICT_ARUCO_ORIGINAL)

    # Tamano de cada codigo
    img_size = 350
    margen_y = (alto - img_size) / 2
    margen_x = 80
    espacio_entre = ancho - (margen_x * 2) - (img_size * 2)

    # Posiciones X para izquierda y derecha
    x_izq = margen_x
    x_der = margen_x + img_size + espacio_entre

    for i in range(0, cantidad, 2):
        # --- Codigo izquierdo ---
        num_lista_1 = i + 1
        if num_lista_1 <= cantidad:
            dibujar_marker(c, dictionary, num_lista_1, x_izq, margen_y, img_size)

        # --- Codigo derecho ---
        num_lista_2 = i + 2
        if num_lista_2 <= cantidad:
            dibujar_marker(c, dictionary, num_lista_2, x_der, margen_y, img_size)

        c.showPage()

    c.save()
    print(f"PDF generado exitosamente en: {ruta_pdf}")
    print(f"Se generaron {cantidad} codigos (2 por pagina horizontal = {(cantidad + 1) // 2} paginas).")

def dibujar_marker(c, dictionary, marker_id, x, y, size):
    """Dibuja un marker ArUco con su numero de lista debajo."""
    # Generar ArUco
    marker_size_px = 600
    marker_img = cv2.aruco.generateImageMarker(dictionary, marker_id, marker_size_px)

    # Borde blanco (quiet zone)
    border_px = 80
    marker_img = cv2.copyMakeBorder(
        marker_img, border_px, border_px, border_px, border_px,
        cv2.BORDER_CONSTANT, value=255
    )

    # Preparar imagen para ReportLab
    _, buffer_arr = cv2.imencode('.png', marker_img)
    buffer = io.BytesIO(buffer_arr.tobytes())
    img = ImageReader(buffer)

    # Dibujar codigo
    c.drawImage(img, x, y, width=size, height=size)

    # Texto: N de Lista (centrado debajo del codigo)
    c.setFont("Helvetica-Bold", 36)
    c.setFillColorRGB(0, 0, 0)
    texto = f"N de Lista: {marker_id}"
    w_texto = c.stringWidth(texto, "Helvetica-Bold", 36)
    texto_x = x + (size - w_texto) / 2
    c.drawString(texto_x, y - 45, texto)

    buffer.close()

if __name__ == "__main__":
    generar_aruco_numero_lista_pdf(60)

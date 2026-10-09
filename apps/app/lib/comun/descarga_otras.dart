/// Fuera del navegador no se guarda nada: quien llama muestra el texto.
bool guardarArchivo(String nombre, String contenido, String tipo) => false;

/// Tampoco un binario: sin permisos de almacenamiento, no hay donde ponerlo.
bool guardarBytes(String nombre, List<int> bytes, String tipo) => false;

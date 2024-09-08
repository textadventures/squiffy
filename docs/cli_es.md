---
layout: index_es
title: Usando Squiffy desde la l&iacute;nea de comandos
redirect_from:
    - "install_es.html"
    - "usage_es.html"
---

Instalaci&oacute;n
----------

Como alternativa a la [versi&oacute;n web](http://textadventures.co.uk/squiffy/editor) y al editor gr&aacute;fico descargable, Squiffy esta tambi&eacute;n disponible como un m&oacute;dulo Node de l&iacute;nea de comandos. Este funciona en Windows, Mac y Linux.

Para instalar el compilador de Squiffy, primero [instala Node.js](http://nodejs.org/).

Despues, instala el [m&oacute;dulo squiffy](https://www.npmjs.org/package/squiffy) desde npm, para ello teclea esto en la l&iacute;nea de comandos o Terminal:

    npm install squiffy -g

La opci&oacute;n `-g` instala el compilador de Squiffy de forma global, para que puedas facilmente ejecutarlo desde cualquier directorio.

**Si la instalaci&oacute;n falla:** En Mac o Linux, si obtienes un error en la instalaci&oacute;n, prueba usando `sudo`:

    sudo npm install squiffy -g

Uso
---

Puedes crear un fichero Squiffy en cualquier editor de textos - Notepad, [Sublime Text](http://www.sublimetext.com/), TextEdit etc.

Los ficheros Squiffy son ficheros de tetxto con extensi&oacute;n `.squiffy`.

Para transformar un fichero Squiffy en un fichero que funcione en un navegador web, colocate en su directorio y teclea lo siguiente en la linea de comandos:

    squiffy mygame.squiffy

Squiffy escribira tres ficheros en el mismo directorio que se encuentra el fichero script: `index.html`, `style.css` y `story.js`. Tambi&eacute;n puede escribir una copia de jQuery (usa la opci&oacute;n `--cdn` para que use jQuery desde la web en vez de crear dicho fichero).

Ejecuta `index.html` para jugar al juego.

Esta carpeta y ficheros puede ahora subirse a cualquier p&aacute;gina web, y se ejecura de forma completa en el navegador web local del jugador (el fichero script con el c&oacute;digo fuente `.squiffy`no es neesario que sea incluido).

El almacenamiento local del navegador web puede ser usado para salvar el estado del juego. Esto hace que el jugador puede cerrar su navegador, y la pr&oacute;xima vez que el regrese a la p&aacute;gina, el juego automaticamente comenzara desde se dejo.

**Nota: Incluso si recompilas el juego, el estado anterior sera cargado.** Esto implica que cad vez que hagas un cambio en tu juego, sea necesario hacer click en el enlace Restart en la parte superior de la pantalla para ver dichos cambios.

Opciones
--------

### CDN

Usa `--cdn` para incorporar jQuery desde CDN en vez de incluir una copia local en tu juego.

### HTTP Server

Usa `--serve` para comenzar un servidor HTTP local despu&eacute;s de compilar. Opcionalmente, puedes especificar un puerto usando `--port`, p.e.

    squiffy mijuego.squiffy --serve --port 31337

### Solo Script

Usa `--scriptonly` para generar *solo* el fichero `story.js`. Puedes opcionalmente especificar tu propio nombre, p.e.

    squiffy mijuego.squiffy --scriptonly miscript.js

### Nombre de Plugin

Squiffy genera un fichero que incluye un pluging jQuery, permitiendote embeber tu juego en cualquier elemento HTML. Por defecto este pluging es llamado usando:

    $('#element').squiffy()

Si tienes multiples juegos Squiffy en una misma p&aacute;gina HTML, necesitaras usar un nombre diferente para cada uno de ellos. Puedes especificar el nombre del pluging usando la opci&oacute;n `--pluginname`.

Por ejemplo:

    squiffy mijuego.squiffy --scriptonly --pluginname mijuego

Esto generara un fichero `story.js` conteniendo un pluging jQuery, icho pluging podr&aacute;s a&ntilde;adirlo a cualquier elemento de una p&aacute;gina HTML usando

    $('#element').mijuego();
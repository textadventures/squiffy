---
layout: index_es
title: Secciones y Pasajes
---

Puedes escribir &iexcl;Hola, Mundo! tal cual:

    ¡Hola, Mundo!
    
Puedes formatear el texto usando [Markdown](http://daringfireball.net/projects/markdown/syntax), y tambi&eacute;n usar HTML.

Para crear historias interactivas, necesitar&aacute;s a&ntilde;adir algunos enlaces. Hay dos tipos de bloques de texto que puedes usar en Squiffy:

- **Secciones** son la unidad principal de texto.
- **Pasajes** son unidades similares que existen dentro de las secciones.

Cuando el jugador entra en una nueva secci&oacute;n todos los enlaces previos son desactivados, usa una nueva secci&oacute;n cuando el jugador haya tomado alguna acci&oacute;n que haga avanzar la historia.

Dentro de una secci&oacute;n, puedes crear enlaces a pasajes. Despu&eacute;s de que el jugador haga click en un enlace a un pasaje, enlaces a otros pasajes dentro de la misma secci&oacute;n pueden permanecer activos.

Secciones
---------

Los nombres de secci&oacute;n deben ser &uacute;nicos dentro de una misma historia. Configura una secci&oacute;n usando corchetes dobles, seguido por dos puntos. Para enlazar a una secci&oacute;n, usa corchetes dobles.

{% include sample_es.html file="sections_es" %}

Para usar un texto diferente en el enlace, coloca el nombre de la secci&oacute;n justo despu&eacute;s entre par&eacute;ntesis.

    Así es [cómo se usa un texto personalizado](section2).

Pasaje
------

Configura un pasaje usando corchetes simples, seguido de dos puntos. Los pasajes pueden enlazar a otros pasajes. Despu&eacute;s de que el jugador haga click en un enlace a un pasaje, este enlace es desactivado, luego el jugador s&oacute;lo podr&aacute; hacer click en el una vez. Para enlazar un pasaje, usa corchetes simples.

{% include sample_es.html file="passages_es" %}

Los enlaces a pasajes pueden explorarse en cualquier orden - en el ejemplo de arriba, el jugador puede mirar primero el libro, despu&eacute;s la TV, despu&eacute;s abrir el libro. Solo despu&eacute;s de hacer click en un enlace a otra secci&oacute;n todos los enlaces que a&uacute;n estuviesen activos ser&iacute;an desactivados.

Los nombres de pasajes deben ser &uacute;nicos dentro de su secci&oacute;n.

Para usar diferentes enlaces de texto, coloca el nombre del pasaje entre par&eacute;ntesis despu&eacute;s del mismo.

    Así es [cómo se usa un texto personalizado](passage1).
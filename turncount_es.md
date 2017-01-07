---
layout: index_es
title: Contando turnos
---

Puedes activar un pasaje despu&eacute;s de que el jugador haya realizado un cierto n&uacute;mero de clicks en una secci&oacute;n. Por ejemplo, puedes visualizar alg&uacute;n texto extra, para indicar el paso del tiempo. O, el pasaje puede ejecutar c&oacute;digo JavaScript para autom&aacute;ticamente mover al jugador a otra secci&oacute;n.

En el ejemplo de abajo, el texto &quot;Estamos llegando. El tren est&aacute; entrando en la v&iacute;a.&quot; siempre sera escrito despu&eacute;s de que se haga click en el primer pasaje. Despu&eacute;s de que se haga click en el segundo pasaje, nos moveremos a la siguiente secci&oacute;n.

{% include sample_es.html file="turncount_es" %}

Tambi&eacute;n puedes activar un pasaje para que sea escrito solo despu&eacute;s de que todos los otros pasajes de esta secci&oacute;n hayan sido clickados.

Mira el el ejemplo de abajo donde despu&eacute;s de que todo los pasajes hayan sido clickados se visualizar&aacute; el texto &quot;Has examinado todas las cosas.&quot;.

{% include sample_es.html file="lastturn_es" %}

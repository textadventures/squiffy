---
layout: index_es
title: Atributos
---


Estableciendo atributos
-----------------------

Puedes establecer un atributo sin secci&oacute;n o pasaje tal que as&iacute;:

    @set score = 1000

Si el valor es un n&uacute;mero, ser&aacute; almacenado como un num&eacute;rico. De otra forma, se almacenar&aacute; como cadena de texto.

Para valores booleanos (true/false), establecer a true:

    @set mi_valor_true
    
y establecer a false:

    @set not mi_valor_false
    
o alternar entre ambos valores:

    @unset mi_valor_false
    
Para valores num&eacute;ricos, puedes aumentar o reducir el valor en 1:

    @inc puntuacion
    @dec salud

O para incrementar o reducir en otras cantidades:

	@inc puntuacion 100
	@dec salud 5

Tambi&eacute;n puedes establecer un valor de un atributo desde un enlace:

```
Eres [[hombre]](start, genero=hombre) o [[mujer]](start, genero=mujer)?

[[start]]:
El valor ha sido guardado.
```

Y por &uacute;ltimo tambi&eacute;n puedes establecer un atributo desde JavaScript:

```
    squiffy.set("genero", "mujer");
```

Leyendo atributos
------------------

Puedes visualizar el valor de un atributo rode&aacute;ndolo con llaves.

```
Has elegido {genero}.
```

Puedes tambi&eacute;n leer el valor usando JavaScript:

```
    var genero = squiffy.get("genero");
```

Puedes visualizar texto condicionalmente dependiendo del valor de un atributo usando "if" dentro de las llaves. Tambi&eacute;n puedes usar "else":

```
{if genero=hombre:Eres un hombre.}{else:Eres una mujer.}
```
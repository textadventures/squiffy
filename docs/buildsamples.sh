for f in samples/*.squiffy
do
	filename=${f##*/}
	noext=${filename%.*}
	squiffy $f --scriptonly $noext.js --pluginname $noext
done
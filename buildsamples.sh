for f in samples/*.squiffy
do
	filename=${f##*/}
	noext=${filename%.*}
	squiffy $f --scriptonly --pluginname $noext
done
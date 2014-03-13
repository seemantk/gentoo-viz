# Generate a manifest of every author in every repository
# This script expects the xml CVS log files to be in the same directory
grep 'author=' gentoo*.xml | \
	awk -F' ' '{print $4}' | \
	awk -F '"' '{print $2}' | \
	sort -n | uniq \
		> committers.txt
# 
# Create the 'devs' subdir if it doesn't exist
[[ -d devs ]] || mkdir devs
# Each author in the manifest gets a consolidated JSON log
# showing all their commits in all the repositories.
for i in `cat committers.txt`; do
	for j in `ls gentoo*.cvs.xml`; do
		# Delete the file if it exists.  We'll create it anew.
		[[ -f ${i}.json ]] && rm ${i}.json
		grep "author=\"${i}\"" ${j} | cut -d' ' -f2-4 | \
			sed \
				-e 's:/var/cvsroot/::' \
				-e 's: :,:g' \
				-e 's:^:,:' \
				-e 's:$:},:' \
				-e 's|=|:|g' \
				-e 's|,\([^:]*\):"|,"\1":"|g' \
				-e 's:^,:{:' \
					>> devs/${i}.json
	done
#
	# Convert each JSON file to an array of objects
	sed -i \
		-e '1 s:^:[:' \
		-e '$ s:,$:]:' \
	devs/${i}.json
done

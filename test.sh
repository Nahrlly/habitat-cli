#!/usr/bin/env bash
echo "Starting"
habitat unregister
habitat register --name "Craziest Space Base You've Ever Seen"
habitat inventory add ferrite 90
habitat inventory add silicate-glass 45
habitat inventory add conductive-ore 18
habitat module set-status supply-cache online
habitat construct small-solar-array
habitat tick --ticks 10800
echo "Complete"

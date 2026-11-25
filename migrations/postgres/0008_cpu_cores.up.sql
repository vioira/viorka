ALTER TABLE nodes ADD COLUMN observed_cpu_cores INTEGER CHECK(observed_cpu_cores BETWEEN 1 AND 65536);

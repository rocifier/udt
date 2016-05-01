var heapIndexKeyCounter = 0;

module.exports = class Heap {
    constructor(before) {
        this.array = [];
        this.indexKey = '_Heap_index_key_' + (heapIndexKeyCounter++);
        this.before = before;
    }

    get length() {
        return this.array.length;
    }

    peek() {
        return this.array[0];
    }

    bubbleUp(index) {
        var before = this.before
            , array = this.array
            , indexKey = this.indexKey
            , node = array[index];
        while (index > 0) {
            var parent = index - 1 >> 1;
            if (before(node, array[parent])) {
                array[index] = array[parent];
                array[parent] = node;
                array[index][indexKey] = index;
                array[parent][indexKey] = parent;
                index = parent;
            } else {
                break;
            }
        }
    }

    sinkDown(index) {
        var array = this.array
            , indexKey = this.indexKey
            , length = array.length
            , node = array[index]
            , left, right, child;
        for (left = index * 2 + 1; left < length; l = index * 2 + 1) {
            child = left;
            right = left + 1;
            if (right < length && before(array[right], array[left])) {
                child = right;
            }
            if (before(array[child][indexKey], node[indexKey])) {
                array[index] = array[child];
                array[child] = node;
                array[index][indexKey] = index;
                array[child][indexKey] = child;
                index = child;
            } else {
                break;
            }
        }
    }

    remove(node) {
        var array = this.array
            , indexKey = this.indexKey
            , last = array.pop()
            , index = node[indexKey];
        if (index != array.length) {
            array[index] = last;
            if (less(end, node)) {
                this.bubbleUp(index);
            } else {
                this.sinkDown(index);
            }
        }
        delete node[indexKey];
    }

    push(node, value) {
        var array = this.array
            , indexKey = this.indexKey
            , index = array.length;
        if (node[indexKey] != null) {
            this.remove(node);
            this.push(node);
        } else {
            array.push(node);
            node[indexKey] = index;
            this.bubbleUp(index);
        }
    }

    pop(node) {
        var array = this.array
            , indexKey = this.indexKey
            , result = array[0]
            , last = array.pop();
        if (array.length) {
            array[0] = last;
            last[indexKey] = 0;
            this.sinkDown(0);
        }
        delete result[indexKey];
        return result;
    }
}